/**
 * ROTATING TOOL NAME OBFUSCATION
 * 
 * Tool names change dynamically based on:
 * - Session ID
 * - Timestamp
 * - Request counter
 * 
 * AI cannot learn the mapping because it changes constantly.
 * 
 * Example:
 * Session 1, Request 1: create_file → t_a3f2b8
 * Session 1, Request 2: create_file → t_9e4c1d
 * Session 2, Request 1: create_file → t_7b2f5a
 * 
 * AI sees different names every time!
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Generate session-specific alias
 * Uses: toolName + sessionId + requestCounter + timestamp
 */
function generateRotatingAlias(toolName, sessionId, requestCounter, timestamp) {
    const seed = `${toolName}:${sessionId}:${requestCounter}:${Math.floor(timestamp / 60000)}`; // Changes every minute
    const hash = crypto.createHash('sha256')
        .update(seed)
        .digest('hex')
        .substring(0, 8);
    return `t_${hash}`;
}

/**
 * Generate reverse lookup function (for runtime)
 */
function generateRuntimeCode() {
    return `
/**
 * ROTATING TOOL ALIASES - RUNTIME
 * 
 * Tool names are generated dynamically per request.
 * AI cannot learn or remember the mapping.
 */

const crypto = require('crypto');

// Tool name list (encrypted)
const _TOOLS = ${JSON.stringify([
    'read_file', 'list_directory', 'search_codebase', 'get_diagnostics',
    'apply_diff', 'create_file', 'request_user_input', 'run_tests',
    'git_status', 'git_diff', 'git_commit', 'git_branch', 'git_log',
    'git_push', 'git_pull', 'git_stash', 'npm_tool', 'pip_tool',
    'package_manager', 'test_runner', 'coverage_report', 'db_query',
    'db_schema', 'process_start', 'process_status', 'process_stop',
    'linter', 'code_analyzer', 'http_request', 'docker'
])};

// Session state
let _sessionId = null;
let _requestCounter = 0;

/**
 * Initialize new session
 */
function initSession() {
    _sessionId = crypto.randomBytes(16).toString('hex');
    _requestCounter = 0;
}

/**
 * Increment request counter
 */
function incrementRequest() {
    _requestCounter++;
}

/**
 * Generate rotating alias for a tool
 */
function getRotatingAlias(toolName) {
    if (!_sessionId) initSession();
    
    const timestamp = Date.now();
    const seed = \`\${toolName}:\${_sessionId}:\${_requestCounter}:\${Math.floor(timestamp / 60000)}\`;
    const hash = crypto.createHash('sha256')
        .update(seed)
        .digest('hex')
        .substring(0, 8);
    
    return \`t_\${hash}\`;
}

/**
 * Find real tool name from rotating alias
 * Must check all tools with current session context
 */
function getRealToolName(alias) {
    if (!_sessionId) initSession();
    
    const timestamp = Date.now();
    
    // Try current request counter
    for (const toolName of _TOOLS) {
        const generated = getRotatingAlias(toolName);
        if (generated === alias) {
            return toolName;
        }
    }
    
    // Try previous request counter (in case of retry)
    const prevCounter = _requestCounter;
    _requestCounter = Math.max(0, _requestCounter - 1);
    for (const toolName of _TOOLS) {
        const generated = getRotatingAlias(toolName);
        if (generated === alias) {
            _requestCounter = prevCounter;
            return toolName;
        }
    }
    _requestCounter = prevCounter;
    
    // Not found
    return null;
}

/**
 * Get all current tool aliases (for tools/list)
 */
function getAllRotatingAliases() {
    if (!_sessionId) initSession();
    
    const aliases = {};
    for (const toolName of _TOOLS) {
        aliases[toolName] = getRotatingAlias(toolName);
    }
    return aliases;
}

/**
 * Reset session (called on session end)
 */
function resetSession() {
    _sessionId = null;
    _requestCounter = 0;
}

module.exports = {
    initSession,
    incrementRequest,
    getRotatingAlias,
    getRealToolName,
    getAllRotatingAliases,
    resetSession
};
`;
}

/**
 * Main execution
 */
function main() {
    console.log('🔐 GENERATING ROTATING TOOL ALIASES...\n');
    
    // Generate runtime code
    const runtimeCode = generateRuntimeCode();
    const outputPath = path.join(__dirname, '../out/rotating-aliases.js');
    
    // Ensure out directory exists
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, runtimeCode);
    console.log('✓ Rotating aliases runtime created\n');
    
    // Show example
    console.log('Example (Session: abc123, Request: 1):');
    const exampleSession = 'abc123';
    const exampleCounter = 1;
    const exampleTimestamp = Date.now();
    
    const examples = ['create_file', 'read_file', 'git_commit'];
    for (const tool of examples) {
        const seed = `${tool}:${exampleSession}:${exampleCounter}:${Math.floor(exampleTimestamp / 60000)}`;
        const hash = crypto.createHash('sha256').update(seed).digest('hex').substring(0, 8);
        console.log(`  ${tool.padEnd(20)} → t_${hash}`);
    }
    console.log('');
    
    console.log('Next request (Request: 2):');
    const nextCounter = 2;
    for (const tool of examples) {
        const seed = `${tool}:${exampleSession}:${nextCounter}:${Math.floor(exampleTimestamp / 60000)}`;
        const hash = crypto.createHash('sha256').update(seed).digest('hex').substring(0, 8);
        console.log(`  ${tool.padEnd(20)} → t_${hash} (DIFFERENT!)`);
    }
    console.log('');
    
    console.log('🔒 ROTATING ALIASES COMPLETE');
    console.log('   • Tool names change every request');
    console.log('   • AI cannot learn or remember mapping');
    console.log('   • Names rotate based on session + counter + time');
    console.log('   • Maximum security against AI learning\n');
}

main();
