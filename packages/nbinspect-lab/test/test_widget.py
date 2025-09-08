"""
Test widget for the nbinspect Lab extension global API.
This demonstrates how external components can subscribe to notebook state changes.
"""

from IPython.display import display, HTML
import ipywidgets as widgets

def create_test_widget():
    """
    Create a test widget that demonstrates the global $Ren API.
    """
    
    # Create output widget to show state changes
    output = widgets.Output()
    
    # Create HTML widget with JavaScript that uses the global API
    html_content = """
    <div id="nbstate-test">
        <h3>NBState API Test</h3>
        <p>Status: <span id="status">Initializing...</span></p>
        <button id="get-state">Get Current State</button>
        <button id="subscribe">Subscribe to Changes</button>
        <button id="unsubscribe">Unsubscribe</button>
        <div id="output" style="margin-top: 10px; padding: 10px; background: #f0f0f0; max-height: 200px; overflow-y: auto;"></div>
    </div>
    
    <script>
    (function() {
        const statusEl = document.getElementById('status');
        const outputEl = document.getElementById('output');
        let cleanup = null;
        
        function log(message) {
            const timestamp = new Date().toLocaleTimeString();
            outputEl.innerHTML += `<div>[${timestamp}] ${message}</div>`;
            outputEl.scrollTop = outputEl.scrollHeight;
        }
        
        function checkAPI() {
            if (window.$Ren) {
                statusEl.textContent = 'API Available';
                statusEl.style.color = 'green';
                log('✓ Global $Ren API is available');
                return true;
            } else {
                statusEl.textContent = 'API Not Available';
                statusEl.style.color = 'red';
                log('✗ Global $Ren API not found');
                return false;
            }
        }
        
        // Check API availability
        setTimeout(checkAPI, 100);
        
        // Get current state button
        document.getElementById('get-state').onclick = function() {
            if (!checkAPI()) return;
            
            const state = window.$Ren.getNBState();
            if (state) {
                log(`Current state: ${state.type} with ${state.nbData?.cellCount || 'unknown'} cells`);
                log(`Timestamp: ${new Date(state.timestamp).toLocaleString()}`);
            } else {
                log('No current state available');
            }
        };
        
        // Subscribe button
        document.getElementById('subscribe').onclick = function() {
            if (!checkAPI()) return;
            
            if (cleanup) {
                log('Already subscribed');
                return;
            }
            
            cleanup = window.$Ren.addStateObserver(function(state) {
                log(`📢 State change: ${state.type}`);
                if (state.type === 'diffs') {
                    log(`   Changes: ${state.changes?.length || 0}`);
                    state.changes?.forEach((change, i) => {
                        const added = change.added?.length || 0;
                        const removed = change.removed?.length || 0;
                        const cells = change.cells?.length || 0;
                        log(`   Change ${i}: ${cells} cells, +${added}, -${removed}`);
                    });
                } else if (state.type === 'state') {
                    log(`   Full state: ${state.cells?.length || 0} cells`);
                }
                log(`   Cell count: ${state.nbData?.cellCount || 'unknown'}`);
            });
            
            log('✓ Subscribed to state changes');
        };
        
        // Unsubscribe button
        document.getElementById('unsubscribe').onclick = function() {
            if (cleanup) {
                cleanup();
                cleanup = null;
                log('✓ Unsubscribed from state changes');
            } else {
                log('Not currently subscribed');
            }
        };
        
        // Auto-check API every 2 seconds if not available
        const checkInterval = setInterval(function() {
            if (checkAPI()) {
                clearInterval(checkInterval);
            }
        }, 2000);
        
    })();
    </script>
    """
    
    html_widget = widgets.HTML(value=html_content)
    
    # Create container
    container = widgets.VBox([
        widgets.HTML("<h2>NBInspect Lab Extension - Global API Test</h2>"),
        html_widget,
        output
    ])
    
    return container

# Example usage
def test_nbstate_api():
    """
    Display the test widget.
    """
    widget = create_test_widget()
    display(widget)
    print("Test widget displayed. Try running some cells to see state changes!")

if __name__ == "__main__":
    test_nbstate_api() 