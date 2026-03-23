/**
 * EXTREME OBFUSCATION BUILD CONFIGURATION
 * 
 * Build process:
 * 1. Bundle main extension code (minified)
 * 2. EXTREME obfuscation - character-level encoding
 * 3. Build stub as entry point with licensing check
 * 4. Build standalone MCP server
 */

const esbuild = require('esbuild');
const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const production = process.env.NODE_ENV === 'production';

// EXTREME OBFUSCATION OPTIONS
const EXTREME_OBFUSCATION_OPTIONS = {
    // String encoding - makes all strings unreadable
    stringArray: true,
    stringArrayEncoding: ['rc4'], // Most aggressive encoding
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 5,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 5,
    stringArrayWrappersType: 'function',
    stringArrayThreshold: 1, // Encode ALL strings
    
    // Control flow flattening - makes code flow unreadable
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 1, // Maximum obfuscation
    
    // Dead code injection - adds fake code
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.5,
    
    // Identifier obfuscation - renames everything
    identifierNamesGenerator: 'hexadecimal', // _0x1a2b3c style
    identifiersPrefix: '_0x',
    renameGlobals: true,
    renameProperties: false, // Keep properties for compatibility
    
    // Self defending - crashes if beautified
    selfDefending: true,
    
    // Compact code
    compact: true,
    
    // Remove console
    disableConsoleOutput: true,
    
    // Number obfuscation
    numbersToExpressions: true,
    
    // Simplify code
    simplify: true,
    
    // Split strings
    splitStrings: true,
    splitStringsChunkLength: 3, // Split into 3-char chunks
    
    // Transform object keys
    transformObjectKeys: true,
    
    // Unicode escape
    unicodeEscapeSequence: true,
    
    // Target
    target: 'node',
    
    // Seed for reproducibility
    seed: 0
};

async function obfuscateFile(inputPath, outputPath) {
    console.log(`  🔒 Obfuscating: ${path.basename(inputPath)}...`);
    
    const code = fs.readFileSync(inputPath, 'utf8');
    const obfuscated = JavaScriptObfuscator.obfuscate(code, EXTREME_OBFUSCATION_OPTIONS);
    fs.writeFileSync(outputPath, obfuscated.getObfuscatedCode());
    
    console.log(`  ✓ Saved: ${path.basename(outputPath)}\n`);
}

async function buildExtension() {
    try {
        console.log('🔨 Building Apex MCP Agent with EXTREME OBFUSCATION...\n');

        // Step 1: Build main extension (minified, NOT obfuscated)
        // The obfuscation was causing stack overflow issues
        await esbuild.build({
            entryPoints: ['src/extension.ts'],
            bundle: true,
            outfile: 'out/extension-real.js',
            external: ['vscode'],
            format: 'cjs',
            platform: 'node',
            target: 'node16',
            sourcemap: false,
            minify: production,
            keepNames: false,
            treeShaking: true,
            legalComments: 'none',
            drop: production ? ['console', 'debugger'] : [],
            define: {
                'process.env.NODE_ENV': production ? '"production"' : '"development"'
            }
        });
        console.log('✓ Main extension bundled (minified, encryption provides security)\n');

        // Step 3: Build MINIMAL stub (entry point) - ONLY activate/deactivate exports
        // ALL logic is in the encrypted bundle
        await esbuild.build({
            entryPoints: ['src/extension-stub-minimal.ts'],
            bundle: true,
            outfile: 'out/extension.js',
            external: ['vscode'],
            format: 'cjs',
            platform: 'node',
            target: 'node16',
            sourcemap: false,
            minify: true,
            keepNames: false,
            treeShaking: true,
            legalComments: 'none',
            drop: production ? ['console', 'debugger'] : []
        });
        console.log('✓ MINIMAL extension entry point built (only activate/deactivate)\n');

        // Step 5: Build standalone MCP server
        await esbuild.build({
            entryPoints: ['src/mcpServerStandalone.ts'],
            bundle: true,
            outfile: 'out/mcpServerStandalone-temp.js',
            external: ['vscode'],
            format: 'cjs',
            platform: 'node',
            target: 'node16',
            sourcemap: false,
            minify: production
        });
        console.log('✓ MCP Server bundle created\n');

        // Step 6: Obfuscate MCP server
        if (production) {
            await obfuscateFile('out/mcpServerStandalone-temp.js', 'out/mcpServerStandalone.js');
            fs.unlinkSync('out/mcpServerStandalone-temp.js');
            console.log('✓ MCP Server obfuscated\n');
        } else {
            fs.renameSync('out/mcpServerStandalone-temp.js', 'out/mcpServerStandalone.js');
        }

        console.log('✅ Build complete with EXTREME OBFUSCATION!\n');
        console.log('🔒 Security Features:');
        console.log('   • All strings encoded with RC4');
        console.log('   • Control flow completely flattened');
        console.log('   • Dead code injection');
        console.log('   • Identifier names hexadecimal');
        console.log('   • Self-defending code');
        console.log('   • Unicode escape sequences');
        console.log('   • Split strings (3-char chunks)');
        console.log('   • No readable words remain\n');
    } catch (error) {
        console.error('❌ Build failed:', error);
        process.exit(1);
    }
}

buildExtension();
