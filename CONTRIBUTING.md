# Contributing to Pluggy

Thank you for your interest in contributing to Pluggy! This document provides guidelines for contributing to this project.

## Development Setup

### Prerequisites
- [Deno](https://deno.land/) v2.x or later
- Git
- A text editor or IDE

### Getting Started
1. Fork the repository
2. Clone your fork locally:
   ```bash
   git clone https://github.com/your-username/pluggy.git
   cd pluggy
   ```
3. Create a new branch for your feature or bugfix:
   ```bash
   git checkout -b feature/your-feature-name
   ```

### Development Workflow
1. Make your changes
2. Test your changes thoroughly:
   ```bash
   # Build the project
   deno task build
   
   # Test the binary
   ./bin/pluggy --help
   ```
3. Ensure code quality:
   ```bash
   # Format code
   deno fmt
   
   # Lint code
   deno lint
   ```

## Code Style

- Use TypeScript with strict type checking
- Follow Deno's standard formatting (use `deno fmt`)
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions focused and reasonably sized

## Testing

- Test all new functionality manually
- Ensure existing functionality still works
- Test on different platforms when possible
- Document any breaking changes

## Submitting Changes

1. Commit your changes with a clear commit message:
   ```bash
   git commit -m "feat: add support for custom repositories"
   ```
2. Push to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
3. Create a Pull Request with:
   - Clear description of the changes
   - Any relevant issue numbers
   - Screenshots for UI changes (if applicable)

## Commit Message Format

Use conventional commit format:
- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation changes
- `refactor:` for code refactoring
- `test:` for test additions
- `chore:` for maintenance tasks

## Reporting Issues

When reporting issues, please include:
- Operating system and version
- Deno version
- Steps to reproduce
- Expected vs actual behavior
- Any error messages

## Feature Requests

Feature requests are welcome! Please:
- Check if the feature already exists
- Describe the use case clearly
- Explain why it would be valuable
- Consider if it fits the project's scope

## Questions?

Feel free to open an issue for questions or discussion about contributing.

Thank you for helping make Pluggy better!
