# Python file - unsupported language for now, should fallback to full read

def calculate_factorial(n):
    """Calculate factorial recursively."""
    if n <= 1:
        return 1
    return n * calculate_factorial(n - 1)

class DataProcessor:
    """Process and transform data."""
    
    def __init__(self, source):
        self.source = source
        self.data = []
    
    def load(self):
        """Load data from source."""
        pass
    
    def transform(self):
        """Transform loaded data."""
        pass
    
    def save(self):
        """Save transformed data."""
        pass
