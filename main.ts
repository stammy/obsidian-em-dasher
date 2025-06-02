import { Plugin, Editor, MarkdownView, EditorPosition } from "obsidian";

interface CM5Editor {
  getTokenAt(pos: EditorPosition, precise?: boolean): CM5Token | null;
}

interface CM5Token {
  start: number;
  end: number;
  string: string;
  type: string | null;
}

function editorHasCm5(editor: Editor): editor is Editor & { cm: CM5Editor } {
  const cm = (editor as { cm?: unknown }).cm;
  return (
    typeof cm === "object" &&
    cm !== null &&
    typeof (cm as CM5Editor).getTokenAt === "function"
  );
}

export default class EmDasherPlugin extends Plugin {
  async onload() {
    this.app.workspace.on("editor-change", this.handleEditorChange);
  }

  async onunload() {
    this.app.workspace.off("editor-change", this.handleEditorChange);
  }

  handleEditorChange = (editor: Editor, markdownView: MarkdownView) => {
    const cursorPos = editor.getCursor();
    const line = editor.getLine(cursorPos.line);

    // Check if enough characters are present for "--<space>"
    if (cursorPos.ch < 3) {
      return;
    }

    const charJustTyped = line.charAt(cursorPos.ch - 1);
    const twoCharsBefore = line.substring(cursorPos.ch - 3, cursorPos.ch - 1);

    // Condition 1: The character just typed is a space.
    if (charJustTyped === " ") {
      // Condition 2: The two characters before the space were "--".
      if (twoCharsBefore === "--") {
        // Condition 3: Ensure we are not converting part of "--- " or "---- ", etc.
        const charBeforePairIndex = cursorPos.ch - 4;
        if (
          charBeforePairIndex < 0 ||
          line.charAt(charBeforePairIndex) !== "-"
        ) {
          // contextCheckPos is the position of the *second dash* of the "--" sequence
          // because outer cursorPos is the space. So cursorPos.ch - 1 is the second dash.
          const contextCheckPos: EditorPosition = {
            line: cursorPos.line,
            ch: cursorPos.ch - 1,
          };
          const textContextBeforeDash = line.substring(0, cursorPos.ch - 3); // Text before "--"
          const contextPosBeforeDash: EditorPosition = {
            line: cursorPos.line,
            ch: cursorPos.ch - 3,
          }; // Position before "--"

          if (
            !this.isInsideCodeBlock(editor, contextCheckPos) &&
            !this.isInsideUrl(
              textContextBeforeDash,
              editor,
              contextPosBeforeDash
            )
          ) {
            editor.replaceRange(
              "—", // Replace with em-dash
              { line: cursorPos.line, ch: cursorPos.ch - 3 }, // Start of "--"
              { line: cursorPos.line, ch: cursorPos.ch - 1 } // End of "--"
            );
          }
        }
      }
    }
  };

  isInsideCodeBlock(editor: Editor, cursorPos: EditorPosition): boolean {
    // cursorPos for this function is the position of the *second dash* of the "--" sequence.

    // Check for fenced code blocks (``` ... ```)
    // This logic uses editor.getLine() and string searches, generally CM-agnostic.
    // Iterate from a few lines above to current line to find start of a block
    for (let i = Math.max(0, cursorPos.line - 10); i <= cursorPos.line; i++) {
      const lineText = editor.getLine(i);
      if (lineText.trim().startsWith("```")) {
        // Found a potential start of a code block. Now check if we're inside it.
        let inBlock = false;
        // Count ``` occurrences from top to current line i to determine if i is inside a block
        for (let j = 0; j < i; j++) {
          if (editor.getLine(j).trim().startsWith("```")) {
            inBlock = !inBlock;
          }
        }
        // If line i starts a block, then we are inside if currently on line i or after
        if (editor.getLine(i).trim().startsWith("```")) {
          inBlock = !inBlock; // Toggle for the current line's own ```
        }

        if (inBlock) {
          let blockStillOpen = true;
          for (let k = i + 1; k <= cursorPos.line; k++) {
            if (editor.getLine(k).trim().startsWith("```")) {
              blockStillOpen = false;
              if (
                k === cursorPos.line &&
                editor.getLine(k).indexOf("```") > cursorPos.ch // cursor is after the second dash
              ) {
                blockStillOpen = true;
              }
            }
          }
          if (blockStillOpen && cursorPos.line >= i) {
            if (
              cursorPos.line === i &&
              // cursorPos.ch is the second dash. indexOf("```") + 2 is end of ```
              cursorPos.ch <= editor.getLine(i).indexOf("```") + 2
            ) {
              // Cursor is on the opening ``` line but at or before the ``` characters.
            } else {
              return true; // Inside a fenced block started on line i
            }
          }
        }
      }
    }
    // If on a line that starts with ``` and cursor (second dash) is after it
    if (
      editor.getLine(cursorPos.line).trim().startsWith("```") &&
      cursorPos.ch > editor.getLine(cursorPos.line).indexOf("```")
    ) {
      let openFences = 0;
      for (let l = 0; l <= cursorPos.line; l++) {
        if (editor.getLine(l).trim().startsWith("```")) {
          openFences++;
        }
      }
      if (openFences % 2 !== 0) return true; // Odd number of fences up to current line means we are inside.
    }

    // Check for inline code (e.g., `code`) using CodeMirror 5 API
    if (editorHasCm5(editor)) {
      const cm5Editor = editor.cm;
      // cursorPos.ch is the position of the *second dash* of "--"
      // We need to get the token at the second dash
      const tokenAtSecondDash = cm5Editor.getTokenAt(cursorPos, true);

      if (
        tokenAtSecondDash &&
        tokenAtSecondDash.type &&
        tokenAtSecondDash.type.includes("code") &&
        tokenAtSecondDash.type.includes("inline")
      ) {
        // Check if this token also covers the *first dash* (which is at cursorPos.ch - 1)
        // token.start is inclusive column
        if (tokenAtSecondDash.start <= cursorPos.ch - 1) {
          return true; // Both dashes are covered by this inline code token
        }
      }
    }
    // Fallback: Check for unclosed backticks on the current line before the "--"
    // cursorPos.ch is the position of the second dash.
    // We need to count backticks before the *first dash*, which is at (cursorPos.ch - 1).
    const currentLine = editor.getLine(cursorPos.line);
    let backtickCount = 0;
    for (let i = 0; i < cursorPos.ch - 1; i++) {
      // Iterate up to char before the first dash
      if (currentLine[i] === "`") {
        backtickCount++;
      }
    }

    if (backtickCount % 2 !== 0) {
      // Odd number of backticks before "--" means we might be inside `...--
      // Now check if there's a closing backtick *after* the second dash (cursorPos.ch)
      if (currentLine.substring(cursorPos.ch + 1).includes("`")) {
        // Check after the second dash
        return true;
      }
    }

    return false;
  }

  isInsideUrl(
    textBeforeDash: string,
    editor: Editor,
    cursorPos: EditorPosition
  ): boolean {
    const currentLine = editor.getLine(cursorPos.line);
    const textAfterDash = currentLine.substring(cursorPos.ch);
    // Construct potential URL around the dashes. Split by space or common markdown link/image delimiters.
    const fullPotentialUrl =
      textBeforeDash + "--" + textAfterDash.split(/[\s()\[\]]/)[0];

    // General URL pattern
    const urlPattern =
      /((?:https?|ftp):\/\/(?:[\w\-]+\.)+[\w\-]+(?:[\w\-\.,@?^=%&:/~\+#]*[\w\-\@?^=%&/~\+#])?)/i;
    if (urlPattern.test(fullPotentialUrl)) {
      const match = fullPotentialUrl.match(urlPattern);
      if (match && match[0].includes("--")) {
        const urlStartIndex = currentLine.indexOf(match[0]);
        if (urlStartIndex === -1) return false; // Match not found in current line, should not happen if logic is correct

        const urlEndIndex = urlStartIndex + match[0].length;
        // Check if the cursor (specifically, the position of '--') is within this recognized URL
        if (cursorPos.ch > urlStartIndex && cursorPos.ch <= urlEndIndex) {
          // Check if the replacement would break the URL structure, e.g., in the domain/host
          const partOfUrlBeforeCursor = match[0].substring(
            0,
            cursorPos.ch - urlStartIndex - 2
          ); // -2 for the '--'
          const hostAndPath = match[0].replace(/^((?:https?|ftp):\/\/)/i, ""); // Case-insensitive for protocol
          const host = hostAndPath.split("/")[0];

          // If '--' is within the host part of the URL, it's critical, so don't replace.
          if (host.includes("--")) {
            // Check if the '--' being considered is *actually* in the host part
            const potentialHostPartInLine = textBeforeDash.substring(
              textBeforeDash.toLowerCase().indexOf(host.toLowerCase())
            );
            if (potentialHostPartInLine.length <= host.length) {
              return true;
            }
          }
          // If it's not in the host, or if the URL parsing is tricky,
          // be cautious: if '--' is in a matched URL, assume it's intentional.
          return true;
        }
      }
    }
    return false;
  }
}
