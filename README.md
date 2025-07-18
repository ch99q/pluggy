
```
 ____  _                            
|  _ \| |_   _  __ _  __ _ _   _ 
| |_) | | | | |/ _` |/ _` | | | |
|  __/| | |_| | (_| | (_| | |_| |
|_|   |_|\__,_|\__, |\__, |\__, |
               |___/ |___/ |___/ 
```

# Pluggy

A command-line tool for Minecraft plugin development that streamlines project initialization, dependency management, and build processes.

## Overview

Pluggy is built around the Modrinth ecosystem, providing a cohesive workflow from project initialization through dependency resolution to final JAR packaging. Rather than being just another build tool, Pluggy leverages Modrinth as the primary source for plugin discovery, dependency management, and version compatibility—making modern Minecraft plugin development faster and more reliable.

## Key Features

- **Project Scaffolding**: Generates complete project structure with proper Java package hierarchy
- **Modrinth Integration**: Direct plugin search, installation, and version management from Modrinth
- **Build Automation**: Handles compilation, resource bundling, and JAR creation
- **Dependency Shading**: Configurable dependency inclusion/exclusion patterns
- **IDE Integration**: Automatic Eclipse project file generation with proper classpaths
- **Platform Compatibility**: Supports Paper, Bukkit, and related server implementations

## Installation

### Windows (PowerShell)
```powershell
irm https://raw.githubusercontent.com/ch99q/pluggy/main/install.ps1 | iex
```

### Unix-like Systems (macOS, Linux)
```bash
curl -fsSL https://raw.githubusercontent.com/ch99q/pluggy/main/install.sh | bash
```

## Command Reference

### Project Lifecycle

```bash
# Initialize new project with interactive prompts
pluggy init

# Initialize with specified parameters
pluggy init --name my-plugin --main com.example.MyPlugin --version 1.0.0

# Build project and generate JAR
pluggy build
```

### Dependency Management

```bash
# Install all project dependencies
pluggy install

# Add specific plugin from Modrinth
pluggy install worldedit

# Add specific version
pluggy install placeholderapi@2.11.6

# Add local JAR file
pluggy install ./libs/custom-library.jar

# Include pre-release versions in search
pluggy install some-plugin --beta

# Remove dependency
pluggy remove worldedit
```

### Information and Discovery

```bash
# Search Modrinth repository
pluggy search "world management"

# Get detailed plugin information
pluggy info worldedit

# Show specific version details
pluggy info worldedit@7.3.15
```

### Global Options

- `--verbose, -v` - Enable detailed logging output
- `--no-color` - Disable colored terminal output  
- `--config-file <path>` - Specify alternative plugin.json location
- `--help, -h` - Display command-specific help
- `--version, -V` - Show Pluggy version information

## Project Configuration

Pluggy projects are configured via `plugin.json` in the project root:

```json
{
  "name": "example-plugin",
  "version": "1.0.0",
  "main": "com.example.ExamplePlugin",
  "description": "An example Minecraft plugin",
  "authors": ["Developer Name"],
  "resources": {
    "config.yml": "./resources/config.yml",
    "plugin.yml": "./resources/plugin.yml"
  },
  "dependencies": {
    "worldedit": "7.3.15",
    "placeholderapi": "2.11.6"
  },
  "shading": {
    "some-library": {
      "include": ["com/library/core/**"],
      "exclude": ["com/library/unused/**"]
    }
  },
  "compatibility": {
    "versions": ["1.21.7", "1.21.3"],
    "platforms": ["paper", "bukkit"]
  }
}
```

### Configuration Fields

- **name**: Plugin identifier (used for JAR filename and plugin.yml)
- **version**: Plugin version (semantic versioning recommended)
- **main**: Fully qualified main class name
- **description**: Plugin description for plugin.yml
- **authors**: Array of author names
- **resources**: File mappings from plugin.yml keys to local paths
- **dependencies**: Modrinth plugin dependencies with versions
- **shading**: Dependency inclusion/exclusion patterns for JAR packaging
- **compatibility**: Target Minecraft versions and server platforms

## Advanced Usage

### Dependency Shading

Shading configuration allows fine-grained control over which dependency classes are included in the final JAR:

```json
{
  "shading": {
    "library-name": {
      "include": ["com/library/api/**", "com/library/util/**"],
      "exclude": ["com/library/internal/**"]
    }
  }
}
```

Patterns use glob syntax (`**` for recursive matching, `*` for single-level wildcards).

### Local Dependencies

Reference local JAR files in your project:

```bash
pluggy install ./libs/proprietary-library.jar
```

This creates a `file:` reference in plugin.json and includes the JAR in classpath generation.

### Platform Compatibility

Pluggy automatically downloads appropriate server JARs for compilation based on your compatibility configuration. The build system selects the most suitable platform and version combination from your specified constraints.

## Build Process Details

The build process performs these operations:

1. **Dependency Resolution**: Downloads and caches Modrinth dependencies
2. **Classpath Generation**: Creates Eclipse .classpath with all dependencies
3. **Resource Processing**: Copies and processes resource files with template variable substitution
4. **Compilation**: Invokes javac with proper classpath and source directories
5. **JAR Assembly**: Packages compiled classes and resources into final JAR
6. **Plugin.yml Generation**: Automatically generates plugin.yml from project configuration

### Template Variables

All resource files are processed with template variable substitution during build:
- `$__PROJECT_NAME__$` - Project name
- `$__PROJECT_VERSION__$` - Project version  
- `$__PROJECT_MAIN_CLASS__$` - Main class name only
- `$__PROJECT_PACKAGE_NAME__$` - Package name without class
- `$__PROJECT_DESCRIPTION__$` - Project description

This allows you to use dynamic values in any resource file (config.yml, plugin.yml, etc.).

## Development

### Prerequisites
- Deno 2.4.1 or later
- Git

### Building from Source
```bash
git clone https://github.com/ch99q/pluggy.git
cd pluggy
deno task build
```

This generates a self-contained executable at `./bin/pluggy`.

### Architecture Notes

Pluggy is implemented in TypeScript using Deno 2.x runtime and standard library. Key architectural decisions:

- **Single binary distribution**: Compiled to native executable for each platform
- **Zero external dependencies**: All functionality implemented using Deno standard library and JSR packages
- **Modrinth API integration**: Direct REST API communication for plugin discovery
- **Template-based code generation**: Parameterized file templates for project scaffolding

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and submission guidelines.

## License

Licensed under the MIT License. See [LICENSE](LICENSE) for details.

