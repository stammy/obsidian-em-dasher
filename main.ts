import { Plugin, Editor, MarkdownView, EditorPosition } from "obsidian";

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
        // This means the character before the "--" pair (if it exists) was not a hyphen.
        const charBeforePairIndex = cursorPos.ch - 4;
        if (
          charBeforePairIndex < 0 ||
          line.charAt(charBeforePairIndex) !== "-"
        ) {
          // Determine the correct position to check for code block/URL context.
          // This should be around the actual "--" sequence.
          const contextCheckPos: EditorPosition = {
            line: cursorPos.line,
            ch: cursorPos.ch - 1,
          }; // Position of the last char of "-- " (the space)
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
    const cmEditor = (editor as any).cm;
    if (!cmEditor || !cmEditor.getModeAt) return false;

    // Check current line and line above for start of a fenced code block
    for (let i = Math.max(0, cursorPos.line - 10); i <= cursorPos.line; i++) {
      // Check recent lines for performance
      const lineText = editor.getLine(i);
      if (lineText.trim().startsWith("```")) {
        // if a block starts here or on a previous line and cursor is within
        let inBlock = false;
        for (let j = 0; j <= cursorPos.line; j++) {
          if (editor.getLine(j).trim().startsWith("```")) inBlock = !inBlock;
        }
        if (
          inBlock ||
          (editor.getLine(cursorPos.line).trim().startsWith("```") &&
            cursorPos.ch > editor.getLine(cursorPos.line).indexOf("```"))
        ) {
          // Now check for closing fence
          for (let k = cursorPos.line; k < editor.lineCount(); k++) {
            if (
              editor
                .getLine(k)
                .includes("```", k === cursorPos.line ? cursorPos.ch : 0)
            )
              return true;
          }
          // If no closing fence is found after the cursor in an opened block, it is considered inside.
          if (inBlock) return true;
        }
      }
    }

    // Check for inline code using CodeMirror tokens if possible
    // This is more reliable than manually parsing backticks
    const token = cmEditor.getTokenAt(cursorPos, true);
    if (
      token &&
      token.type &&
      token.type.includes("code") &&
      token.type.includes("inline")
    ) {
      // Check if the '--' is within the bounds of this inline code token
      const lineContent = editor.getLine(cursorPos.line);
      const dashStartIndex = cursorPos.ch - 2;
      if (dashStartIndex >= token.start && cursorPos.ch <= token.end) {
        // check if the actual characters -- are within the token range that is marked as code
        if (lineContent.substring(token.start, token.end).includes("--")) {
          return true;
        }
      }
    }

    // Fallback for inline code (if token check is not sufficient or fails)
    const currentLine = editor.getLine(cursorPos.line);
    let backtickCount = 0;
    for (let i = 0; i < cursorPos.ch - 2; i++) {
      // Count backticks before the potential '--'
      if (currentLine[i] === "`") {
        backtickCount++;
      }
    }
    // If an odd number of backticks appear before, it means we're inside an inline code block
    if (backtickCount % 2 !== 0) {
      // Check if there is a closing backtick after the cursor
      if (currentLine.substring(cursorPos.ch).includes("`")) {
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
