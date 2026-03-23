/**
 * =============================================================================
 * APEX MCP AGENT - TOOLS INDEX
 * =============================================================================
 * 
 * Central export for all tools - Super Robust MCP Agent
 * Includes P0, P1, P2, P3 tools for full-stack development automation
 */

// Base classes and registry
export { BaseTool } from './baseTool';
export { ToolRegistry } from './registry';

// Original tools
export { ReadFileTool } from './readFileTool';
export { SearchCodebaseTool } from './searchCodebaseTool';
export { ListDirectoryTool } from './listDirectoryTool';
export { GetDiagnosticsTool } from './getDiagnosticsTool';
export { ApplyDiffTool } from './applyDiffTool';
export { CreateFileTool } from './createFileTool';
export { RequestUserInputTool } from './requestUserInputTool';
export { RunTestsTool } from './runTestsTool';

// P0 - Git Tools
export * from './git';

// P0 - Package Manager Tools
export * from './packageManagers';

// P1 - Testing Tools
export * from './testing';

// P1 - Database Tools
export * from './database';

// P1 - Process Management Tools
export * from './process';

// P2 - Code Analysis Tools
export * from './codeAnalysis';

// P2 - API Testing Tools
export * from './apiTesting';

// P2 - Container Tools
export * from './container';

import { ToolRegistry } from './registry';
import { SecurityManager } from '../security';
import { SessionManager } from '../session';

// Import all tools
import { ReadFileTool } from './readFileTool';
import { SearchCodebaseTool } from './searchCodebaseTool';
import { ListDirectoryTool } from './listDirectoryTool';
import { GetDiagnosticsTool } from './getDiagnosticsTool';
import { ApplyDiffTool } from './applyDiffTool';
import { CreateFileTool } from './createFileTool';
import { RequestUserInputTool } from './requestUserInputTool';
import { RunTestsTool } from './runTestsTool';

// Git Tools
import { GitStatusTool, GitDiffTool, GitCommitTool, GitBranchTool, GitLogTool, GitPushTool, GitPullTool, GitStashTool } from './git';

// Package Manager Tools
import { NpmTool, PipTool, PackageManagerTool } from './packageManagers';

// Testing Tools
import { TestRunnerTool, CoverageReportTool } from './testing';

// Database Tools
import { DatabaseQueryTool, DatabaseSchemaTool } from './database';

// Process Tools
import { ProcessStartTool, ProcessStatusTool, ProcessStopTool } from './process';

// Code Analysis Tools
import { LinterTool, CodeAnalyzerTool } from './codeAnalysis';

// API Testing Tools
import { HttpRequestTool } from './apiTesting';

// Container Tools
import { DockerTool } from './container';

/**
 * Create and register all built-in tools
 */
export function createToolRegistry(
    securityManager: SecurityManager,
    sessionManager: SessionManager
): ToolRegistry {
    const registry = new ToolRegistry(securityManager, sessionManager);

    // =========================================================================
    // ORIGINAL TOOLS (Core functionality)
    // =========================================================================

    registry.registerTool(new ReadFileTool());
    registry.registerTool(new ListDirectoryTool());
    registry.registerTool(new SearchCodebaseTool());
    registry.registerTool(new GetDiagnosticsTool());
    registry.registerTool(new ApplyDiffTool());
    registry.registerTool(new CreateFileTool());

    const userInputTool = new RequestUserInputTool();
    userInputTool.setSessionManager(sessionManager);
    registry.registerTool(userInputTool);

    registry.registerTool(new RunTestsTool());

    // =========================================================================
    // P0 - GIT TOOLS (CRITICAL)
    // =========================================================================

    registry.registerTool(new GitStatusTool());
    registry.registerTool(new GitDiffTool());
    registry.registerTool(new GitCommitTool());
    registry.registerTool(new GitBranchTool());
    registry.registerTool(new GitLogTool());
    registry.registerTool(new GitPushTool());
    registry.registerTool(new GitPullTool());
    registry.registerTool(new GitStashTool());

    // =========================================================================
    // P0 - PACKAGE MANAGER TOOLS (CRITICAL)
    // =========================================================================

    registry.registerTool(new NpmTool());
    registry.registerTool(new PipTool());
    registry.registerTool(new PackageManagerTool());

    // =========================================================================
    // P1 - TESTING TOOLS (HIGH)
    // =========================================================================

    registry.registerTool(new TestRunnerTool());
    registry.registerTool(new CoverageReportTool());

    // =========================================================================
    // P1 - DATABASE TOOLS (HIGH)
    // =========================================================================

    registry.registerTool(new DatabaseQueryTool());
    registry.registerTool(new DatabaseSchemaTool());

    // =========================================================================
    // P1 - PROCESS MANAGEMENT TOOLS (HIGH)
    // =========================================================================

    registry.registerTool(new ProcessStartTool());
    registry.registerTool(new ProcessStatusTool());
    registry.registerTool(new ProcessStopTool());

    // =========================================================================
    // P2 - CODE ANALYSIS TOOLS (MEDIUM)
    // =========================================================================

    registry.registerTool(new LinterTool());
    registry.registerTool(new CodeAnalyzerTool());

    // =========================================================================
    // P2 - API TESTING TOOLS (MEDIUM)
    // =========================================================================

    registry.registerTool(new HttpRequestTool());

    // =========================================================================
    // P2 - CONTAINER TOOLS (MEDIUM)
    // =========================================================================

    registry.registerTool(new DockerTool());

    // =========================================================================
    // LOG REGISTERED TOOLS
    // =========================================================================

    console.log(`Apex MCP: Registered ${registry.getAllSchemas().length} tools`);

    return registry;
}

/**
 * Tool categories for reference
 */
export const TOOL_CATEGORIES = {
    // Original
    READ_ONLY: ['read_file', 'list_directory', 'search_codebase', 'get_diagnostics', 'request_user_input'],
    DESTRUCTIVE: ['apply_diff', 'create_file'],
    REQUIRES_CONFIRMATION: ['apply_diff', 'create_file', 'run_tests', 'git_commit', 'git_push', 'git_pull', 'npm_tool', 'pip_tool', 'db_query', 'process_start', 'process_stop', 'docker'],
    TEST: ['run_tests', 'test_runner', 'coverage_report'],

    // P0 - Critical
    GIT: ['git_status', 'git_diff', 'git_commit', 'git_branch', 'git_log', 'git_push', 'git_pull', 'git_stash'],
    PACKAGE_MANAGER: ['npm_tool', 'pip_tool', 'package_manager'],

    // P1 - High
    TESTING: ['test_runner', 'coverage_report'],
    DATABASE: ['db_query', 'db_schema'],
    PROCESS: ['process_start', 'process_status', 'process_stop'],

    // P2 - Medium
    CODE_ANALYSIS: ['linter', 'code_analyzer'],
    API_TESTING: ['http_request'],
    CONTAINER: ['docker']
};
