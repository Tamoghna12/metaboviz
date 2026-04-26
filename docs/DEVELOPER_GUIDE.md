# Developer Guide

**Complete guide for contributing to and developing MetabolicSuite**

---

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Building and Running](#building-and-running)
- [Performance Optimization](#performance-optimization)
- [Common Patterns](#common-patterns)

---

## Getting Started

### Prerequisites

**Required**:
- **Node.js**: v18.0 or higher
- **npm** or **yarn**: v9.0+ or v1.22+
- **Git**: For version control
- **Editor**: VS Code (recommended) or similar

**Recommended**:
- **VS Code Extensions**:
  - ESLint
  - Prettier
  - GitLens
  - Tailwind CSS IntelliSense
  - ES7+ JavaScript code snippets

### Initial Setup

```bash
# Clone repository
git clone https://github.com/yourusername/metabolic-suite.git
cd metabolic-suite

# Install dependencies
npm install

# Start development server
npm run dev

# Open http://localhost:5173
```

---

## Development Setup

### VS Code Configuration

Create `.vscode/settings.json`:
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "eslint.validate": [
    "javascript",
    "javascriptreact"
  ],
  "editor.tabSize": 2,
  "editor.insertSpaces": true
}
```

### Git Hooks Setup

Install Husky for pre-commit hooks:
```bash
npm install --save-dev husky lint-staged
npx husky install
```

Configure pre-commit hooks in `package.json`:
```json
{
  "scripts": {
    "prepare": "husky install",
    "lint-staged": "lint-staged"
  },
  "lint-staged": {
    "*.{js,jsx}": [
      "eslint --fix",
      "prettier --write"
    ]
  }
}
```

---

## Project Structure

```
metabolic-suite/
├── public/                  # Static assets served by Vite
│   ├── index.html          # Entry HTML
│   ├── icon.svg           # App icon
│   ├── manifest.json       # PWA manifest
│   └── vite.svg          # Vite logo
├── src/                    # Source code
│   ├── components/          # React components
│   │   ├── MetabolicModelingPlatform.jsx
│   │   ├── EnhancedModeling.jsx
│   │   ├── OmicsDataUpload.jsx
│   │   ├── PathwayMapBuilder.jsx
│   │   ├── SubsystemView.jsx
│   │   ├── Visualizations.jsx
│   │   ├── EducationalFeatures.jsx
│   │   ├── OmicsLearningBridge.jsx
│   │   ├── ModelUpload.jsx
│   │   └── widgets/         # Reusable widgets
│   ├── lib/                # Core algorithms
│   │   ├── FBASolver.js
│   │   │   └── FBASolver.test.js
│   │   ├── OmicsIntegration.js
│   │   │   └── OmicsIntegration.test.js
│   │   └── ForceLayout.js
│   ├── utils/              # Utility functions
│   │   ├── sbmlParser.js
│   │   └── modelParser.js
│   ├── contexts/           # React Context providers
│   │   ├── ModelContext.jsx
│   │   ├── OmicsContext.jsx
│   │   └── ThemeContext.jsx
│   ├── hooks/              # Custom React hooks
│   │   ├── useKeyboardShortcuts.js
│   │   ├── useMapHistory.js
│   │   └── useMapSearch.js
│   ├── data/               # Static data
│   │   ├── metabolicData.js
│   │   └── pathwayTemplates.js
│   ├── widget/             # Jupyter widget entry
│   │   └── index.jsx
│   ├── App.jsx             # Main app component
│   ├── main.jsx            # Application entry point
│   ├── App.css             # Global styles
│   └── index.css           # CSS reset
├── docs/                   # Documentation
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── INSTALLATION.md
│   ├── USER_GUIDE.md
│   ├── DEVELOPER_GUIDE.md
│   ├── DEPLOYMENT.md
│   ├── CONTRIBUTING.md
│   ├── TROUBLESHOOTING.md
│   ├── ALGORITHMS.md
│   ├── REFERENCE_MODELS.md
│   └── CHANGELOG.md
├── python/                 # Jupyter widget
│   ├── metabolicsuite/
│   │   ├── __init__.py
│   │   ├── widget.py
│   │   ├── parsers.py
│   │   └── templates.py
│   ├── pyproject.toml
│   └── README.md
├── tests/                  # Additional test files (if needed)
├── .gitignore
├── .eslintrc.js          # ESLint configuration
├── .prettierrc            # Prettier configuration
├── index.html
├── package.json
├── vite.config.js
├── vite.widget.config.js
├── postcss.config.js
└── vitest.config.js
```

---

## Coding Standards

### JavaScript/JSX Style Guide

Follow **Airbnb JavaScript Style Guide**:
https://github.com/airbnb/javascript

**Key Rules**:
- Use 2 spaces for indentation
- Use semicolons
- Use single quotes for strings
- Use const/let, avoid var
- Use template literals for multi-line strings
- Use arrow functions
- Use destructuring
- Use default parameters

**Example**:
```javascript
// Good
const { reactions, metabolites } = model;
const calculateFlux = (substrate, oxygen) => {
  return Math.min(substrate * 0.088, oxygen * 0.044);
};

// Bad
var reactions = model.reactions;
function calculateFlux(substrate, oxygen) {
  return Math.min(substrate * 0.088, oxygen * 0.044);
}
```

### React Best Practices

**Component Structure**:
```jsx
import React from 'react';
import { useModel } from '../contexts/ModelContext';

/**
 * Brief component description
 * @param {Object} props - Component props
 * @returns {JSX.Element} Rendered output
 */
export default function MyComponent({ prop1, prop2, onAction }) {
  // 1. Destructure props
  const { currentModel } = useModel();
  
  // 2. Define state (use hooks)
  const [localState, setLocalState] = React.useState(null);
  
  // 3. Define handlers (useCallback)
  const handleClick = React.useCallback(() => {
    onAction(prop1, localState);
  }, [prop1, localState, onAction]);
  
  // 4. Define effects (useEffect)
  React.useEffect(() => {
    // Side effects
    return () => {
      // Cleanup
    };
  }, [prop1]);
  
  // 5. Render
  return (
    <div className="component-class">
      <button onClick={handleClick}>Action</button>
    </div>
  );
}
```

**Naming Conventions**:
- **Components**: PascalCase (`MyComponent.jsx`)
- **Functions**: camelCase (`calculateFlux`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_ITERATIONS`)
- **Private functions**: camelCase with underscore prefix (`_internalFunction`)

### Prop Types

Use **JSDoc** comments for prop documentation:

```jsx
/**
 * Props for MyComponent
 * @typedef {Object} MyComponentProps
 * @property {string} prop1 - First prop description
 * @property {number} prop2 - Second prop description
 * @property {function} onAction - Callback function
 */
```

### Comments

**JSDoc for exports**:
```javascript
/**
 * Calculate FBA solution
 * @param {Object} model - Metabolic model
 * @param {Object} options - Solver options
 * @returns {Promise<Object>} - FBA result
 */
export async function solveFBA(model, options) {
  // Implementation
}
```

**Inline comments**:
```javascript
// Good: Brief, explain why
const flux = calculateFlux(substrate); // Calculate based on substrate

// Bad: Redundant, obvious
const flux = calculateFlux(substrate); // Call function with substrate
```

### Error Handling

**Synchronous functions**:
```javascript
try {
  const result = parseSBML(xmlString);
  return result;
} catch (error) {
  console.error('SBML parsing failed:', error);
  throw new Error('Failed to parse SBML: ' + error.message);
}
```

**Async functions**:
```javascript
export async function solveFBA(model, options) {
  if (!model || !model.reactions) {
    throw new Error('Model is required');
  }
  
  try {
    const result = await glpk.solve(problem);
    return result;
  } catch (error) {
    console.error('FBA solving failed:', error);
    throw new Error('Failed to solve FBA: ' + error.message);
  }
}
```

---

## Testing

### Running Tests

```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage

# Run specific test file
npm run test FBASolver.test.js

# Run tests matching pattern
npm run test -- -t "GPR"
```

### Writing Tests

Use **Vitest** and **React Testing Library**:

```javascript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { evaluateGPR } from '../lib/FBASolver';

describe('GPR Evaluation', () => {
  it('should evaluate single gene as active when present', () => {
    const activeGenes = new Set(['gene1']);
    const result = evaluateGPR('gene1', activeGenes);
    expect(result).toBe(true);
  });
  
  it('should evaluate single gene as inactive when absent', () => {
    const activeGenes = new Set(['gene2']);
    const result = evaluateGPR('gene1', activeGenes);
    expect(result).toBe(false);
  });
});
```

**Testing React Components**:
```javascript
import { render, screen, fireEvent } from '@testing-library/react';
import ModelUpload from '../ModelUpload';

describe('ModelUpload', () => {
  it('should render upload button', () => {
    render(<ModelUpload />);
    expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument();
  });
  
  it('should call onUpload when file selected', () => {
    const handleUpload = vi.fn();
    render(<ModelUpload onUpload={handleUpload} />);
    
    const input = screen.getByLabelText(/upload/i);
    const file = new File([''], 'model.xml', { type: 'text/xml' });
    
    fireEvent.change(input, { target: { files: [file] } });
    
    expect(handleUpload).toHaveBeenCalledWith(expect.any(File));
  });
});
```

### Test Organization

**Test file structure**:
```
src/lib/FBASolver.test.js
├── Unit Tests
│   ├── GPR parsing
│   ├── Stoichiometric matrix
│   └── Gene extraction
├── Integration Tests
│   ├── FBA solving (requires browser)
│   ├── FVA solving
│   └── pFBA solving
└── Validation Tests
    ├── Analytical solutions
    └── Published benchmarks

src/lib/OmicsIntegration.test.js
├── Unit Tests
│   ├── GPR to expression mapping
│   ├── Expression normalization
│   └── Integration method configuration
└── Edge Cases
    ├── Malformed GPR strings
    └── Empty/null values
```

### Coverage Requirements

- **Unit tests**: 80%+ coverage
- **Integration tests**: All major workflows
- **Edge cases**: Null values, empty arrays, malformed input

---

## Building and Running

### Development Server

```bash
# Start dev server
npm run dev

# Options:
npm run dev -- --host 0.0.0.0  # Expose to network
npm run dev -- --port 3000       # Use specific port
npm run dev -- --open             # Auto-open browser
```

### Production Build

```bash
# Build for production
npm run build

# Output: dist/ directory
```

### Build Configuration

**vite.config.js**:
```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'glpk.js': ['glpk.js']
        }
      }
    }
  }
});
```

---

## Performance Optimization

### Code Splitting

```javascript
// Lazy load heavy components
const PathwayMapBuilder = React.lazy(() => import('./PathwayMapBuilder'));
const FluxHeatmap = React.lazy(() => import('./Visualizations').then(m => ({ default: m.FluxHeatmap })));

// Use in component with Suspense
<Suspense fallback={<Loading />}>
  <PathwayMapBuilder />
</Suspense>
```

### Memoization

```javascript
import React, { useMemo, useCallback } from 'react';

export default function ExpensiveComponent({ largeData }) {
  // Memoize expensive calculations
  const processedData = useMemo(() => {
    return largeData.map(item => {
      // Expensive transformation
      return transform(item);
    });
  }, [largeData]);
  
  // Memoize event handlers
  const handleClick = useCallback((item) => {
    // Handle click
  }, [dependency]);
  
  return <div>{/* render */}</div>;
}
```

### Web Workers (Future Enhancement)

Offload LP solving to Web Worker:

```javascript
// worker.js
self.importScripts('glpk.js');

self.onmessage = async (e) => {
  const { model, options } = e.data;
  const result = await solveFBA(model, options);
  self.postMessage(result);
};

// main.js
const worker = new Worker('worker.js');
worker.postMessage({ model, options });
worker.onmessage = (e) => {
  const result = e.data;
  // Handle result
};
```

---

## Common Patterns

### Context Usage Pattern

```javascript
// Consumer component
import { useModel } from '../contexts/ModelContext';

export default function MyComponent() {
  const { currentModel, loadModel } = useModel();
  
  const handleFileSelect = (file) => {
    loadModel(file);
  };
  
  return <div>{/* render */}</div>;
}

// Provider component (in App.jsx)
import { ModelProvider } from './contexts/ModelContext';

function App() {
  return (
    <ModelProvider>
      {/* All child components */}
    </ModelProvider>
  );
}
```

### Custom Hook Pattern

```javascript
import { useState, useCallback } from 'react';

export function useMyFeature(dependencies) {
  const [state, setState] = useState(initialState);
  
  const updateState = useCallback((newState) => {
    setState(newState);
  }, []);
  
  return { state, updateState };
}
```

### Async Data Fetching Pattern

```javascript
import { useState, useEffect } from 'react';

export default function DataLoader({ source }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  useEffect(() => {
    let cancelled = false;
    
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const result = await fetch(source);
        if (!cancelled) {
          setData(result);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
    
    return () => {
      cancelled = true;
    };
  }, [source]);
  
  return { data, loading, error };
}
```

### Form Handling Pattern

```javascript
import { useState, useCallback } from 'react';

export default function Form({ onSubmit }) {
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  
  const handleChange = useCallback((e) => {
    const { name, value, type } = e.target;
    setValues(prev => ({ ...prev, [name]: type === 'checkbox' ? value : parseFloat(value) }));
    setErrors(prev => ({ ...prev, [name]: null }));
  }, []);
  
  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    const newErrors = validate(values);
    
    if (Object.keys(newErrors).length === 0) {
      onSubmit(values);
    } else {
      setErrors(newErrors);
    }
  }, [values, onSubmit]);
  
  return (
    <form onSubmit={handleSubmit}>
      {/* Form fields */}
    </form>
  );
}
```

---

## Debugging

### Chrome DevTools

```javascript
// Install React DevTools
npm install --save-dev @welldone-software/agency/react-redux

// Use in development
if (import.meta.env.DEV) {
  const DevTools = require('@welldone-software/agency/react-redux');
  DevTools.initialize();
}
```

### Console Logging

```javascript
// Conditional logging based on environment
const DEBUG = import.meta.env.DEV;

function debugLog(...args) {
  if (DEBUG) {
    console.log('[DEBUG]', ...args);
  }
}

export function solveFBA(model, options) {
  debugLog('Starting FBA with model:', model.id);
  
  try {
    const result = await glpk.solve(problem);
    debugLog('FBA result:', result.status);
    return result;
  } catch (error) {
    debugLog('FBA error:', error);
    throw error;
  }
}
```

### Error Boundary

```javascript
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  
  static getDerivedStateFromError(error, errorInfo) {
    return { hasError: true, error };
  }
  
  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }
  
  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          <details>
            <summary>{this.state.error && this.state.error.toString()}</summary>
            <p>Check the console for more details</p>
          </details>
        </div>
      );
    }
    
    return this.props.children;
  }
}

// Wrap main app
<ErrorBoundary>
  <App />
</ErrorBoundary>
```

---

## Contributing Workflow

### Creating a Branch

```bash
# Create feature branch from main
git checkout -b feature/my-new-feature

# Or from develop
git checkout -b feature/my-new-feature develop

# Ensure up-to-date
git pull origin main
```

### Committing Changes

```bash
# Stage changes
git add .

# Commit with conventional message
git commit -m "feat: Add GIMME integration to UI"

# See git status
git status
```

### Pull Request Process

```bash
# Push branch to remote
git push origin feature/my-new-feature

# Create pull request via GitHub
gh pr create --title "Add GIMME integration" --body "Description of changes"
```

**PR Checklist**:
- [ ] Tests pass (`npm run test`)
- [ ] Linting passes (`npm run lint`)
- [ ] Documentation updated
- [ ] All tests pass (CI/CD)
- [ ] No merge conflicts
- [ ] PR description is clear

---

## Next Steps

- Review [API documentation](./API.md) for module interfaces
- Check [troubleshooting guide](./TROUBLESHOOTING.md) for common issues
- See [contributing guidelines](./CONTRIBUTING.md) for workflow details

---

*Last Updated: December 25, 2025*
