/**
 * Language and build system detection
 *
 * Detects programming languages and their corresponding build commands
 * through heuristic scanning of language-specific config files and dependencies.
 *
 * Supported languages:
 * - TypeScript (tsconfig.json, typescript dependency, npm build script)
 * - Go (go.mod, go build)
 * - Rust (Cargo.toml, cargo build)
 * - Java (build.gradle/Gradle, pom.xml/Maven)
 * - Python (setup.py, pyproject.toml, python -m build)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

type SupportedLanguage = 'typescript' | 'go' | 'rust' | 'java' | 'python';
type JavaBuildSystem = 'gradle' | 'maven';

/**
 * Build capability descriptor
 */
export interface BuildCapability {
  language: SupportedLanguage;
  command: string;
  detected: true;
}

/**
 * Detect the programming language of a project
 *
 * Priority order (first match wins):
 * 1. TypeScript (tsconfig.json or typescript dependency)
 * 2. Go (go.mod)
 * 3. Rust (Cargo.toml)
 * 4. Java (build.gradle or pom.xml)
 * 5. Python (setup.py or pyproject.toml)
 *
 * @param workspaceRoot - Root directory to scan
 * @returns Language name or null if not detected
 */
export function detectLanguage(workspaceRoot: string): SupportedLanguage | null {
  // Validate that the directory exists
  if (!fs.existsSync(workspaceRoot)) {
    return null;
  }

  // TypeScript detection
  if (fs.existsSync(path.join(workspaceRoot, 'tsconfig.json'))) {
    return 'typescript';
  }
  if (hasTypeScriptDependency(workspaceRoot)) {
    return 'typescript';
  }

  // Go detection
  if (fs.existsSync(path.join(workspaceRoot, 'go.mod'))) {
    return 'go';
  }

  // Rust detection
  if (fs.existsSync(path.join(workspaceRoot, 'Cargo.toml'))) {
    return 'rust';
  }

  // Java detection (check Gradle first)
  if (fs.existsSync(path.join(workspaceRoot, 'build.gradle'))) {
    return 'java';
  }
  if (fs.existsSync(path.join(workspaceRoot, 'pom.xml'))) {
    return 'java';
  }

  // Python detection
  if (fs.existsSync(path.join(workspaceRoot, 'setup.py'))) {
    return 'python';
  }
  if (fs.existsSync(path.join(workspaceRoot, 'pyproject.toml'))) {
    return 'python';
  }

  return null;
}

/**
 * Check if TypeScript is declared as a dependency
 *
 * Reads package.json and checks for typescript in dependencies or devDependencies
 */
function hasTypeScriptDependency(workspaceRoot: string): boolean {
  const packageJsonPath = path.join(workspaceRoot, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.peerDependencies,
    };
    return 'typescript' in allDeps;
  } catch {
    // Malformed package.json; not a TypeScript project
    return false;
  }
}

/**
 * Detect which Java build system is used
 *
 * @param workspaceRoot - Root directory to scan
 * @returns 'gradle' or 'maven', or null if neither detected
 */
function detectJavaBuildSystem(workspaceRoot: string): JavaBuildSystem | null {
  if (fs.existsSync(path.join(workspaceRoot, 'build.gradle'))) {
    return 'gradle';
  }
  if (fs.existsSync(path.join(workspaceRoot, 'pom.xml'))) {
    return 'maven';
  }
  return null;
}

/**
 * Get the build command for a detected language
 *
 * @param workspaceRoot - Root directory of the project
 * @param language - Detected language
 * @param javaSystem - (Optional) Java build system; auto-detected if not provided
 * @returns Build command string or null if not determinable
 */
export function getBuildCommand(
  workspaceRoot: string,
  language: SupportedLanguage,
  javaSystem?: JavaBuildSystem,
): string | null {
  switch (language) {
    case 'typescript':
      // Prefer explicit npm run build script; fallback to npm run build
      return 'npm run build';

    case 'go':
      return 'go build';

    case 'rust':
      return 'cargo build';

    case 'java': {
      const system = javaSystem || detectJavaBuildSystem(workspaceRoot);
      if (system === 'gradle') {
        return 'gradle build';
      }
      if (system === 'maven') {
        return 'mvn clean install';
      }
      return null;
    }

    case 'python':
      return 'python -m build';

    default:
      // Handle unknown languages gracefully
      return null;
  }
}

/**
 * Detect the build capability of a project
 *
 * Combines language detection and build command lookup into a single operation.
 * Returns a structured descriptor if a supported build system is found.
 *
 * @param workspaceRoot - Root directory to scan
 * @returns BuildCapability if detected, null otherwise
 *
 * @example
 * const capability = detectBuildCapability('/path/to/repo');
 * if (capability) {
 *   console.log(`Language: ${capability.language}`);
 *   console.log(`Build: ${capability.command}`);
 * } else {
 *   console.log('No supported build system detected');
 * }
 */
export function detectBuildCapability(workspaceRoot: string): BuildCapability | null {
  const language = detectLanguage(workspaceRoot);
  if (!language) {
    return null;
  }

  const command = getBuildCommand(workspaceRoot, language);
  if (!command) {
    return null;
  }

  return {
    language,
    command,
    detected: true,
  };
}
