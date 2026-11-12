import { describe, expect, test } from "bun:test";
import {
  isContentlessBinaryPatch,
  parseDiffFilePathLines,
  parseDiffGitHeader,
  parsePatchPathToken,
  unquoteGitPath,
} from "./diff-paths";

describe("isContentlessBinaryPatch", () => {
  test("flags a git binary chunk with no hunks", () => {
    expect(isContentlessBinaryPatch([
      "diff --git a/logo.png b/logo.png",
      "index 1111111111aa..2222222222bb 100644",
      "Binary files a/logo.png and b/logo.png differ",
      "",
    ].join("\n"))).toBe(true);
  });

  test("flags a review stub for a file the server declined to read", () => {
    expect(isContentlessBinaryPatch([
      "diff --git a/src/Panel.tsx b/src/Panel.tsx",
      "similarity index 94%",
      "rename from src/Card.tsx",
      "rename to src/Panel.tsx",
      "index bab081fdb737..99fffbd3cac3 100644",
      "Binary files a/src/Card.tsx and b/src/Panel.tsx differ",
      "",
    ].join("\n"))).toBe(true);
  });

  test("flags a literal GIT binary patch payload", () => {
    expect(isContentlessBinaryPatch([
      "diff --git a/logo.png b/logo.png",
      "GIT binary patch",
      "literal 12",
      "",
    ].join("\n"))).toBe(true);
  });

  test("does not flag a text patch", () => {
    expect(isContentlessBinaryPatch([
      "diff --git a/calc.ts b/calc.ts",
      "--- a/calc.ts",
      "+++ b/calc.ts",
      "@@ -1,2 +1,2 @@",
      "-const b = 1;",
      "+const b = 2;",
      "",
    ].join("\n"))).toBe(false);
  });

  test("does not flag a text patch whose content mentions the binary marker", () => {
    // Content lines always carry a +/-/space prefix, and the scan stops at the
    // first hunk header, so quoted marker text cannot be mistaken for a header.
    expect(isContentlessBinaryPatch([
      "diff --git a/notes.md b/notes.md",
      "--- a/notes.md",
      "+++ b/notes.md",
      "@@ -1,2 +1,2 @@",
      "-old note",
      "+Binary files a/x and b/x differ",
      " GIT binary patch",
      "",
    ].join("\n"))).toBe(false);
  });

  test("does not flag a metadata-only chunk with no binary marker", () => {
    // A pure mode change has no body either, but git says nothing about
    // content there, so it keeps its existing rendering.
    expect(isContentlessBinaryPatch([
      "diff --git a/run.sh b/run.sh",
      "old mode 100644",
      "new mode 100755",
      "",
    ].join("\n"))).toBe(false);
  });
});

describe("diff path parsing", () => {
  test("unquoteGitPath decodes octal (UTF-8 byte) escapes", () => {
    // git C-quotes non-ASCII names as raw UTF-8 bytes in octal — the exact
    // form ls-files/status/diff emit for "café.txt" with core.quotePath on.
    expect(unquoteGitPath('"caf\\303\\251.txt"')).toBe("café.txt");
    expect(unquoteGitPath('"\\346\\227\\245\\346\\234\\254.md"')).toBe("日本.md");
    expect(unquoteGitPath('"tab\\there"')).toBe("tab\there");
    expect(unquoteGitPath('"quote\\"in name"')).toBe('quote"in name');
    // Our own quoteGitPath (JSON.stringify) leaves unicode LITERAL inside
    // quotes — synthesized workspace headers round-trip through here too.
    expect(unquoteGitPath('"café file.txt"')).toBe("café file.txt");
    expect(unquoteGitPath('"emoji 🎉.txt"')).toBe("emoji 🎉.txt");
    // …and emits \uXXXX for control chars without a short JSON escape.
    expect(unquoteGitPath('"a\\u000bb.txt"')).toBe("a\u000bb.txt");
    // Malformed \u (too few hex digits) keeps the backslash literally.
    expect(unquoteGitPath('"a\\u0b.txt"')).toBe("a\\u0b.txt");
    // Unquoted input passes through untouched.
    expect(unquoteGitPath("plain space.txt")).toBe("plain space.txt");
  });

  test("strips tab metadata from unquoted file path lines", () => {
    expect(parseDiffFilePathLines([
      "--- a/my file\t",
      "+++ b/my file\t",
      "@@ -1 +1 @@",
    ])).toEqual({
      oldPath: "my file",
      newPath: "my file",
    });
  });

  test("preserves escaped tabs inside quoted file paths", () => {
    expect(parseDiffFilePathLines([
      '--- "a/my\\tfile"',
      '+++ "b/my\\tfile"',
      "@@ -1 +1 @@",
    ])).toEqual({
      oldPath: "my\tfile",
      newPath: "my\tfile",
    });
  });

  test("preserves dev null paths with tab metadata", () => {
    expect(parsePatchPathToken("/dev/null\t", "a")).toBe("/dev/null");
  });
});

describe("parseDiffGitHeader", () => {
  // `git diff` leaves a space unquoted, and emits no `---`/`+++` or rename
  // lines for a mode-only or a binary change, so the header is the only source
  // of those files' paths. A directory ending in " b" then puts a second
  // " b/" in the header, where a greedy split lands inside the path.
  test("splits an unquoted path that itself contains a b-prefix", () => {
    expect(parseDiffGitHeader("diff --git a/dir b/mode.txt b/dir b/mode.txt")).toEqual({
      oldPath: "dir b/mode.txt",
      newPath: "dir b/mode.txt",
    });
    expect(parseDiffGitHeader("diff --git a/a b/c.png b/a b/c.png")).toEqual({
      oldPath: "a b/c.png",
      newPath: "a b/c.png",
    });
  });

  test("keeps reading ordinary and quoted headers", () => {
    expect(parseDiffGitHeader("diff --git a/src/calc.ts b/src/calc.ts")).toEqual({
      oldPath: "src/calc.ts",
      newPath: "src/calc.ts",
    });
    expect(parseDiffGitHeader("diff --git a/my file.txt b/my file.txt")).toEqual({
      oldPath: "my file.txt",
      newPath: "my file.txt",
    });
    expect(parseDiffGitHeader("diff --git a/src/Card.tsx b/src/Panel.tsx")).toEqual({
      oldPath: "src/Card.tsx",
      newPath: "src/Panel.tsx",
    });
    expect(parseDiffGitHeader('diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"')).toEqual({
      oldPath: "café.txt",
      newPath: "café.txt",
    });
  });

  test("reads nothing from a line that is not a diff header", () => {
    expect(parseDiffGitHeader("index 587be6b..742c16a 100644")).toEqual({});
    expect(parseDiffGitHeader("diff --git nothing here")).toEqual({});
  });
});
