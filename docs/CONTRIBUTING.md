# Contributing Guidelines

**How to contribute to MetabolicSuite development**

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing Requirements](#testing-requirements)
- [Documentation Requirements](#documentation-requirements)
- [Reporting Bugs](#reporting-bugs)
- [Feature Requests](#feature-requests)

---

## Code of Conduct

### Our Pledge

In the interest of fostering an open and welcoming environment, we as contributors and maintainers pledge to make participation in our project and our community a harassment-free experience for everyone, regardless of age, body size, disability, ethnicity, gender identity and expression, level of experience, education, socio-economic status, nationality, personal appearance, race, religion, or sexual identity and orientation.

### Our Standards

**Examples of behavior that contributes to creating a positive environment**:
- Using welcoming and inclusive language
- Being respectful of differing viewpoints and experiences
- Gracefully accepting constructive criticism
- Focusing on what is best for the community
- Showing empathy towards other community members

**Examples of unacceptable behavior**:
- The use of sexualized language or imagery
- Unwelcome sexual attention or advances
- Trolling, insulting/derogatory comments, or personal/ political attacks
- Public or private harassment
- Publishing others' private information, such as physical or email addresses, without explicit permission
- Other unethical or unprofessional conduct

### Our Responsibilities

**Project maintainers**:
- Clarify the standards of acceptable behavior
- Create a safe and welcoming environment
- Take appropriate and fair corrective action in response to instances of unacceptable behavior

**Project contributors**:
- Refrain from harassing behavior
- Follow the code of conduct
- Report unacceptable behavior to maintainers

### Enforcement

Instances of abusive, harassing, or otherwise unacceptable behavior may be reported by contacting the project team at [support-email@example.com]. All complaints will be reviewed and investigated and will result in a response that is deemed necessary and appropriate to the circumstances.

---

## Getting Started

### First-Time Setup

1. **Fork Repository**:
   - Go to https://github.com/yourusername/metabolic-suite
   - Click "Fork" button in top-right
   - Select your account as destination

2. **Clone Forked Repository**:
   ```bash
   git clone https://github.com/yourusername/metabolic-suite.git
   cd metabolic-suite
   ```

3. **Install Dependencies**:
   ```bash
   npm install
   ```

4. **Start Development Server**:
   ```bash
   npm run dev
   ```

5. **Verify Installation**:
   - Open http://localhost:5173
   - Run `npm run test`
   - Run `npm run lint`

---

## Development Workflow

### Branching Strategy

```
main          ← Production releases (deployed)
  ↑
develop        ← Development branch (integrates features)
  ↑
feature/*     ← Feature branches (individual features)
```

**Workflow**:
1. Create feature branch from `develop`
2. Make changes on feature branch
3. Commit frequently with clear messages
4. Create pull request to `develop`
5. After review and merge, delete feature branch
6. Periodically merge `develop` into `main`

### Creating a Feature Branch

```bash
# Ensure up-to-date with develop
git fetch origin
git checkout develop
git pull origin develop

# Create feature branch
git checkout -b feature/amazing-new-feature
```

### Naming Conventions

**Branch Names**:
- Feature: `feature/amazing-feature`
- Bugfix: `fix/nasty-bug`
- Hotfix: `hotfix/critical-fix` (for production)
- Release: `release/v1.0.0`

**Commit Messages**:
Follow [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <subject>

<BLANK LINE>
<body>
```

**Types**:
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvement
- `test`: Adding or updating tests
- `chore`: Build process or auxiliary tool changes

**Scopes**: (optional)
- `solver`: FBA/FVA/pFBA/MOMA changes
- `ui`: Component changes
- `docs`: Documentation changes
- `parser`: SBML/parser changes

**Examples**:
```
feat(solver): Add GIMME integration
fix(ui): Resolve memory leak in pathway map
docs(readme): Update installation instructions
style(formatter): Apply Prettier to all files
test(fbasolver): Add GPR edge case tests
```

---

## Pull Request Process

### Before Submitting PR

**Checklist**:
- [ ] Code follows [coding standards](#coding-standards)
- [ ] All tests pass (`npm run test`)
- [ ] Linting passes (`npm run lint`)
- [ ] Self-reviewed the code
- [ ] Added or updated tests as needed
- [ ] Added or updated documentation as needed
- [ ] Commit messages follow [conventional commits](#branching-strategy)
- [ ] PR description clearly explains changes

### PR Title Format

```
<type>: <short description>
```

**Examples**:
```
feat: Add E-Flux omics integration
fix: Resolve SBML parsing error for nested GPR
docs: Update API documentation
```

### PR Description Template

```markdown
## Changes
<!-- Brief description of changes -->

## Type of Change
<!-- Check all that apply -->
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
<!-- How you tested your changes -->
- [ ] Unit tests added/updated
- [ ] Manual testing performed
- [ ] All tests passing

## Screenshots (if UI changes)
<!-- Add screenshots for UI changes -->

## Checklist
- [ ] Code follows project style guide
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] Tests pass locally
```

### Review Process

**What to expect**:
- **Code review**: Maintainers will review your code for quality and correctness
- **Feedback**: You may receive comments for improvements
- **Iteration**: You may need to make changes before merge
- **CI/CD**: Automated tests must pass before merge

**How to respond**:
- Be responsive to feedback
- Make requested changes promptly
- Ask questions if anything is unclear
- Thank reviewers for their time

---

## Coding Standards

### JavaScript Style

Follow **Airbnb JavaScript Style Guide**:
https://github.com/airbnb/javascript

**Key Rules**:
- Use 2 spaces for indentation
- Use semicolons
- Use single quotes for strings
- Use `const` and `let`, avoid `var`
- Prefer arrow functions
- Use template literals over string concatenation

**Examples**:
```javascript
// Good
const calculateFlux = (substrate, oxygen) => {
  const total = Math.min(substrate * 0.088, oxygen * 0.044);
  return Math.max(0, total);
};

// Bad
function calculateFlux(substrate, oxygen) {
  var total = Math.min(substrate * 0.088, oxygen * 0.044);
  return Math.max(0, total);
}
```

### React Best Practices

- **Functional components** with hooks
- **Props**: Use TypeScript-style prop interfaces (in JSDoc)
- **State**: Use hooks, avoid class components unless necessary
- **Effects**: Use `useEffect` for side effects, provide cleanup
- **Performance**: Use `useMemo` and `useCallback` for expensive operations

**Component Structure**:
```jsx
import React, { useState, useCallback, useMemo } from 'react';
import { useModel } from '../contexts/ModelContext';

/**
 * Component description
 */
export default function MyComponent({ prop1, onAction }) {
  // Hooks at top
  const { currentModel } = useModel();
  const [state, setState] = useState(initialState);
  
  // Memoized values
  const memoizedValue = useMemo(() => {
    return expensiveCalculation(prop1, currentModel);
  }, [prop1, currentModel]);
  
  // Memoized callbacks
  const handleClick = useCallback((event) => {
    onAction(prop1, state);
  }, [prop1, state, onAction]);
  
  // Effects
  React.useEffect(() => {
    // Side effect
    return () => {
      // Cleanup
    };
  }, [prop1]);
  
  // Render
  return <div>{/* JSX */}</div>;
}
```

### Documentation Comments

**Function Documentation**:
```javascript
/**
 * Solve Flux Balance Analysis problem
 * @param {Object} model - Metabolic model with reactions and metabolites
 * @param {Object} options - Solver options (objective, knockouts, constraints)
 * @returns {Promise<Object>} - FBA result with fluxes and growth rate
 * @throws {Error} If model is invalid or solving fails
 * 
 * @example
 * // Usage example
 * const result = await solveFBA(model, { objective: 'BIOMASS' });
 * console.log(`Growth: ${result.objectiveValue}`);
 */
export async function solveFBA(model, options) {
  // Implementation
}
```

**Inline Comments**:
```javascript
// Calculate flux from substrate uptake
const flux = calculateFlux(substrate); // Units: mmol/gDW/h

// Apply gene knockout effect
const effectiveGenes = allGenes.filter(g => !knockedOut.has(g)); // Remove knocked-out genes

// Build stoichiometric matrix
const { S, metabolites, reactions } = buildStoichiometricMatrix(model); // Dense M×R matrix
```

---

## Testing Requirements

### Test Coverage

- **Target**: 80%+ code coverage
- **Critical paths**: 100% coverage
- **Unit tests**: Test individual functions in isolation
- **Integration tests**: Test component interactions
- **End-to-end tests**: Test user workflows

### Writing Tests

Use **Vitest** and **React Testing Library**:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { evaluateGPR } from '../lib/FBASolver';

describe('GPR Evaluation', () => {
  // Arrange: Setup test data
  const activeGenes = new Set(['geneA', 'geneB', 'geneC']);
  
  // Act & Assert: Test behavior
  it('should evaluate AND correctly', () => {
    const result = evaluateGPR('geneA and geneB', activeGenes);
    expect(result).toBe(true);
  });
  
  it('should evaluate OR correctly', () => {
    const result = evaluateGPR('geneA or geneD', activeGenes);
    expect(result).toBe(true);
  });
});
```

### Test Organization

**Unit Tests** (`*.test.js`):
- GPR parsing logic
- Stoichiometric matrix construction
- Gene extraction
- Omics integration methods

**Integration Tests** (if needed):
- Component rendering
- User interactions
- Context provider behavior

---

## Documentation Requirements

### API Documentation

- Add **JSDoc** to all exported functions
- Include `@param`, `@returns`, `@throws` tags
- Include `@example` for complex functions
- See [API.md](./API.md) for complete reference

### User Documentation

- Update [USER_GUIDE.md](./USER_GUIDE.md) for new features
- Add screenshots for UI changes
- Include code examples for new APIs
- Document breaking changes clearly

### README Updates

Keep `README.md` current with:
- Installation instructions
- Quick start guide
- Feature highlights
- Link to full documentation

---

## Reporting Bugs

### Before Reporting

1. **Check existing issues**:
   - Search GitHub issues for similar problems
   - Comment on existing if it's the same issue

2. **Gather information**:
   - Browser name and version
   - Steps to reproduce
   - Expected behavior
   - Actual behavior
   - Screenshots (if applicable)

### Issue Template

```markdown
## Bug Description
<!-- Brief description of the bug -->

## Environment
- Browser: Chrome/Firefox/Safari/Edge
- Version: 90/88/14/90
- Operating System: Windows/macOS/Linux
- Node.js version: v18.0.0

## Steps to Reproduce
1. First step
2. Second step
3. ...

## Expected Behavior
<!-- What should happen -->

## Actual Behavior
<!-- What actually happens -->

## Screenshots
<!-- If applicable -->

## Additional Context
<!-- Any other relevant information -->
```

### Bug Fix Checklist

- [ ] Bug confirmed and reproducible
- [ ] Root cause identified
- [ ] Fix implemented
- [ ] Tests added to prevent regression
- [ ] Documentation updated
- [ ] Tested in multiple browsers
- [ ] PR submitted

---

## Feature Requests

### Before Proposing

1. **Check existing issues**:
   - Search for similar feature requests
   - Comment on existing if related

2. **Consider impact**:
   - Does it fit project goals?
   - Is it within scope?
   - What's the effort required?
   - Are there security implications?

3. **Gather requirements**:
   - What problem does it solve?
   - Who is it for?
   - Are there alternatives?
   - What are the success criteria?

### Feature Request Template

```markdown
## Feature Description
<!-- Clear description of the feature -->

## Problem Statement
<!-- What problem does this solve? -->

## Proposed Solution
<!-- How should it work? -->

## Alternatives Considered
<!-- What alternatives did you consider and why did you reject them? -->

## Success Criteria
<!-- How do we know when this is complete? -->

## Implementation Ideas
<!-- Rough implementation approach, if known -->
```

---

## Large Contributions

### Major Feature Development

For significant changes that require more than a few hours:

1. **Discussion First**:
   - Open issue describing the feature
   - Discuss approach with maintainers
   - Get feedback before starting

2. **RFC (Request for Comments)**:
   - Create design document
   - Present to community for review
   - Iterate based on feedback

3. **Proof of Concept**:
   - Create minimal implementation
   - Validate approach
   - Get feedback before full implementation

4. **Incremental PRs**:
   - Break into smaller PRs
   - Merge incrementally
   - Maintain stability throughout

### Breaking Changes

For changes that break existing functionality:

1. **Document heavily**:
   - Explain what's breaking
   - Provide migration guide
   - Add deprecation warnings

2. **Version bump**:
   - Major version increase (e.g., 2.0.0)

3. **Communication**:
   - Announce in advance
   - Provide migration support
   - Monitor adoption

---

## Recognition

### Contributor Hall of Fame

Significant contributors will be recognized in:
- README.md contributors section
- Release notes
- Community blog posts

### Reviewer Recognition

Active reviewers who consistently provide quality feedback will be recognized in:
- README.md reviewers section
- Maintainer discussions
- Conference presentations

---

## Getting Help

### Communication Channels

- **GitHub Issues**: https://github.com/yourusername/metabolic-suite/issues
- **GitHub Discussions**: https://github.com/yourusername/metabolic-suite/discussions
- **Email**: [support-email@example.com](mailto:support-email@example.com)

### Asking Questions

Before asking for help:
1. Search existing documentation
2. Search existing issues/discussions
3. Prepare minimal reproducible example
4. Be specific about what you're trying to do

**Good question**:
```markdown
I'm trying to implement GIMME integration following the API docs at docs/API.md, but I'm getting an error when calling solveGIMME() with omics data.

Here's my code:
```javascript
const result = await solveGIMME(model, geneExpression, {
  threshold: 0.25
});
```

The error is: "Gene expression data must be a Map<string, number>". But I'm passing a new Map() with string keys and number values.

What am I doing wrong?

Environment:
- Node.js v18.0.0
- Browser: Chrome 90
```

### Office Hours

Regular community office hours will be scheduled for:
- New contributors onboarding
- Feature discussions
- Code reviews
- Q&A sessions

Check the repository's Discussions tab for scheduled office hours.

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License. See [LICENSE](../LICENSE) file for details.

---

## Next Steps

- Read [developer guide](./DEVELOPER_GUIDE.md) for development setup
- Review [API documentation](./API.md) for module interfaces
- Check [troubleshooting guide](./TROUBLESHOOTING.md) for common issues
- Start contributing! 🚀

---

Thank you for contributing to MetabolicSuite! Your contributions make this project better for everyone.

---

*Last Updated: December 25, 2025*
