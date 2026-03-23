/**
 * HONEYPOT TRAP
 * 
 * Creates a decoy file that triggers when someone extracts out.zip
 * Shows a funny message and optionally logs the attempt
 */

const fs = require('fs');
const path = require('path');

const FUNNY_MESSAGE = `
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║                    🕵️  WELL, WELL, WELL...                     ║
║                                                                ║
║                  Look who's feeling curious! 🔍                ║
║                                                                ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  Nice try, detective! But this code is more protected than    ║
║  my grandma's secret cookie recipe. 🍪                         ║
║                                                                ║
║  Here's what you're looking at:                               ║
║  ✓ AES-256 Encryption                                         ║
║  ✓ Rotating Tool Names (changes every request)                ║
║  ✓ Obfuscated beyond recognition                              ║
║  ✓ Zero-knowledge architecture                                ║
║                                                                ║
║  But hey, I respect the hustle! 💪                            ║
║                                                                ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  🤝 Want to collaborate instead?                              ║
║                                                                ║
║  • Licensing: Get your own branded version                    ║
║  • Partnership: Let's build something together                ║
║  • Custom Development: I take commissions                     ║
║                                                                ║
║  📧 Contact: apex.mcp.agent@gmail.com                         ║
║  🌐 Website: https://apex-mcp.com                             ║
║                                                                ║
║  P.S. - Coffee's on me if you're in town ☕                   ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝

Press any key to close...
`;

const HTML_POPUP = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>🕵️ Caught You!</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 600px;
            padding: 40px;
            text-align: center;
            animation: slideIn 0.5s ease-out;
        }
        
        @keyframes slideIn {
            from { transform: translateY(-50px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        
        .emoji {
            font-size: 80px;
            margin-bottom: 20px;
            animation: bounce 1s infinite;
        }
        
        @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-20px); }
        }
        
        h1 {
            color: #333;
            font-size: 32px;
            margin-bottom: 10px;
        }
        
        .subtitle {
            color: #666;
            font-size: 18px;
            margin-bottom: 30px;
        }
        
        .message {
            background: #f8f9fa;
            border-left: 4px solid #667eea;
            padding: 20px;
            margin: 20px 0;
            text-align: left;
            border-radius: 8px;
        }
        
        .message p {
            margin: 10px 0;
            color: #555;
            line-height: 1.6;
        }
        
        .cta {
            margin-top: 30px;
        }
        
        .btn {
            display: inline-block;
            padding: 15px 30px;
            margin: 10px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-decoration: none;
            border-radius: 50px;
            font-weight: bold;
            transition: transform 0.2s;
        }
        
        .btn:hover {
            transform: scale(1.05);
        }
        
        .footer {
            margin-top: 30px;
            color: #999;
            font-size: 14px;
        }
        
        .respect {
            background: #fff3cd;
            border: 2px solid #ffc107;
            border-radius: 10px;
            padding: 15px;
            margin: 20px 0;
            color: #856404;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="emoji">🕵️</div>
        <h1>Well, Well, Well...</h1>
        <p class="subtitle">Look who's feeling curious!</p>
        
        <div class="message">
            <p><strong>Nice try, detective!</strong> 🔍</p>
            <p>But this code is more protected than Fort Knox:</p>
            <p>✓ AES-256 Encryption<br>
               ✓ Rotating Tool Names<br>
               ✓ Obfuscated Beyond Recognition<br>
               ✓ Zero-Knowledge Architecture</p>
        </div>
        
        <div class="respect">
            <strong>🤝 I respect the hustle though!</strong><br>
            You clearly know your way around code.
        </div>
        
        <div class="message">
            <p><strong>Want to collaborate instead?</strong></p>
            <p>• <strong>Licensing:</strong> Get your own branded version<br>
               • <strong>Partnership:</strong> Let's build together<br>
               • <strong>Custom Dev:</strong> I take commissions</p>
        </div>
        
        <div class="cta">
            <a href="mailto:apex.mcp.agent@gmail.com" class="btn">📧 Let's Talk</a>
            <a href="https://apex-mcp.com" class="btn">🌐 Visit Website</a>
        </div>
        
        <div class="footer">
            P.S. - Coffee's on me if you're in town ☕<br>
            No hard feelings, I'd do the same 😎
        </div>
    </div>
</body>
</html>`;

function createHoneypot() {
    console.log('🍯 Creating honeypot trap...\n');
    
    const outDir = path.join(__dirname, '../out');
    
    // Create README.txt (text version)
    const readmePath = path.join(outDir, 'README.txt');
    fs.writeFileSync(readmePath, FUNNY_MESSAGE);
    console.log('✓ Created README.txt trap\n');
    
    // Create index.html (opens in browser)
    const htmlPath = path.join(outDir, 'OPEN_ME.html');
    fs.writeFileSync(htmlPath, HTML_POPUP);
    console.log('✓ Created OPEN_ME.html trap\n');
    
    // Create Windows batch script
    const batScript = `@echo off
start "" "${htmlPath}"
type "${readmePath}"
pause
`;
    const batPath = path.join(outDir, 'START_HERE.bat');
    fs.writeFileSync(batPath, batScript);
    console.log('✓ Created START_HERE.bat trap\n');
    
    // Create shell script for Mac/Linux
    const shScript = `#!/bin/bash
open "${htmlPath}" 2>/dev/null || xdg-open "${htmlPath}" 2>/dev/null
cat "${readmePath}"
read -p "Press any key to continue..."
`;
    const shPath = path.join(outDir, 'START_HERE.sh');
    fs.writeFileSync(shPath, shScript);
    fs.chmodSync(shPath, '755');
    console.log('✓ Created START_HERE.sh trap\n');
    
    console.log('🎭 HONEYPOT COMPLETE!');
    console.log('   When user extracts out.zip:');
    console.log('   1. They see: START_HERE.bat / START_HERE.sh');
    console.log('   2. They click it (curiosity!)');
    console.log('   3. Beautiful popup appears 😄');
    console.log('   4. Your contact info displayed\n');
}

createHoneypot();
