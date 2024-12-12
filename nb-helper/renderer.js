// This script runs in the notebook output webview
debugger;

const _summ_stl = `
<style>
  .update-flash { animation: flash 0.5s ease-out; }
  @keyframes flash {
    0% { background-color: pink; }
    100% { background-color: transparent; }
  }
  .cell-info { margin-bottom: 1em; }
  .output-info { margin-left: 2em; }
</style>
`;

function _truncate(str, maxLength = 100) {
  return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
}

// Summary of the notebook state (for debugging)
function _summaryHTML(message) {
  return message.data.map((cell, idx) => `
    <div class="cell-info">
      <strong>Cell ${idx}</strong> (${cell.kind}, index: ${cell.index})
      <div class="cell-text">Source: ${JSON.stringify(_truncate(cell.text))}</div>
      ${(cell.outputs && cell.outputs.length) ? `
        <div class="output-info">
          Outputs: ${cell.outputs.map((out) => `
            <div>ID: ${out.id}
              ${out.items.map((item) => `
                <div>Mime: ${item.mime}</div>
              `
              ).join("")}
            </div>
          `).join("")}
        </div>
      ` : " (No outputs)"
      }
    </div>
  `).join("")
}

function renderNBState(message, element) {
  if (message.type === "state") {
    const t = new Date().toLocaleTimeString();
    message.timestamp = t;
    const updateClass = message.changeType === "notebookUpdate" ? "update-flash" : "";
    const stateJSON = JSON.stringify(message);
    element.innerHTML = `
      <div class="timestamp">Last updated: ${message.timestamp}</div>
      ${_summ_stl}
      <details id="notebook-state" class="${updateClass}">
        <summary><strong>Cells:</strong></summary>
        ${_summaryHTML(message)}
      </details>
      <script id="notebook-state-json" type="application/json">${stateJSON}</script>
    `;
  }
}

export function activate(context) {
  return {
    renderOutputItem(outputItem, element) {
      try {
        const textDecoder = new TextDecoder();
        const jsonString = textDecoder.decode(outputItem.data());
        const notebookState = JSON.parse(jsonString);

        if (context.postMessage) {
          const messageListener = context.onDidReceiveMessage((message) => {
            if (message.type === "error") {
              element.innerHTML = `<div class="error">${message.message}</div>`;
              return;
            }
            renderNBState(message, element);
          });

          setTimeout(() => {
            context.postMessage({
              type: "getState",
              outputId: outputItem.id, // Send output ID
            });
          }, 100);
        }

        element.innerHTML = `
                  <div id="notebook-state">
                      <div>Requesting notebook state...</div>
                  </div>
              `;
      } catch (error) {
        console.error("Error in renderer:", error);
        element.innerHTML = `<div class="error">Error: ${error.message}</div>`;
      }
    },
  };
}
