"""
Test script for the nbinspect Lab extension MIME renderer.
Run this in a Jupyter notebook to test the custom MIME type functionality.
"""

from IPython.display import display

def configure_nbstate(feedback=True, watch=False, debug=False):
    """
    Configure the nbinspect Lab extension via custom MIME type.
    
    Args:
        feedback (bool): Show visual feedback for notebook changes
        watch (bool): Enable watch mode (not used in Lab extension yet)
        debug (bool): Enable debug mode
    """
    data = {
        "feedback": feedback,
        "watch": watch,
        "debug": debug
    }
    
    display({
        "application/x-notebook-state": data
    }, raw=True)
    
    print(f"NBState configuration sent: {data}")

# Example usage:
if __name__ == "__main__":
    print("Testing nbinspect Lab extension MIME renderer...")
    print("Run these functions in a notebook cell:")
    print()
    print("# Enable feedback")
    print("configure_nbstate(feedback=True)")
    print()
    print("# Disable feedback")  
    print("configure_nbstate(feedback=False)")
    print()
    print("# Enable debug mode")
    print("configure_nbstate(feedback=True, debug=True)") 