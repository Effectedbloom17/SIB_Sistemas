#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TOOL_VERSION = '1.0.0';
const SEVERITY_WEIGHT = {
    info: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4
};

const EXCLUDED_DIRS = new Set([
    '.git',
    'node_modules',
    'dist',
    'reports',
    'coverage',
    '.angular',
    '.idea',
    '.vscode',
    'tmp',
    'out-tsc'
]);

const TEXT_EXTENSIONS = new Set([
    '.js',
    '.cjs',
    '.mjs',
    '.ts',
    '.tsx',
    '.jsx',
    '.json',
    '.md',
    '.sql',
    '.yml',
    '.yaml',
    '.sh',
    '.ps1',
    '.txt',
    '.env'
]);

const CODE_EXTENSIONS = new Set([
    '.js',
    '.cjs',
    '.mjs',
    '.ts',
    '.tsx',
    '.jsx'
]);

function parseArgs(argv) {
    const options = {
        projectRoot: process.cwd(),
        outDir: path.join(process.cwd(), 'reports', 'security-audit'),
        format: 'both',
        skipDeps: false,
        failOn: 'high',
        quiet: false,
        maxFileSizeKb: 2048,
        maxFiles: 12000
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        switch (arg) {
            case '--project-root':
                options.projectRoot = path.resolve(argv[++i] || options.projectRoot);
                break;
            case '--out-dir':
                options.outDir = path.resolve(argv[++i] || options.outDir);
                break;
            case '--format':
                options.format = (argv[++i] || 'both').toLowerCase();
                break;
            case '--skip-deps':
                options.skipDeps = true;
                break;
            case '--fail-on':
                options.failOn = (argv[++i] || 'high').toLowerCase();
                break;
            case '--quiet':
                options.quiet = true;
                break;
            case '--max-file-size-kb':
                options.maxFileSizeKb = Number(argv[++i] || options.maxFileSizeKb);
                break;
            case '--max-files':
                options.maxFiles = Number(argv[++i] || options.maxFiles);
                break;
            case '--help':
            case '-h':
                printHelp();
                process.exit(0);
                break;
            default:
                throw new Error(`Argumento no soportado: ${arg}`);
        }
    }

    if (!['json', 'md', 'both'].includes(options.format)) {
        throw new Error('--format debe ser uno de: json, md, both');
    }

    if (!Object.prototype.hasOwnProperty.call(SEVERITY_WEIGHT, options.failOn) && options.failOn !== 'none') {
        throw new Error('--fail-on debe ser uno de: none, info, low, medium, high, critical');
    }

    if (!Number.isFinite(options.maxFileSizeKb) || options.maxFileSizeKb <= 0) {
        throw new Error('--max-file-size-kb debe ser un numero positivo');
    }

    if (!Number.isFinite(options.maxFiles) || options.maxFiles <= 0) {
        throw new Error('--max-files debe ser un numero positivo');
    }

    return options;
}

function printHelp() {
    const helpText = [
        'Uso: node scripts/security-audit.js [opciones]',
        '',
        'Opciones:',
        '  --project-root <path>      Ruta del proyecto (default: cwd)',
        '  --out-dir <path>           Carpeta de reportes (default: reports/security-audit)',
        '  --format <json|md|both>    Formato de salida (default: both)',
        '  --skip-deps                Omite npm audit de dependencias',
        '  --fail-on <severity|none>  Exit code 2 si existe hallazgo >= severidad (default: high)',
        '  --max-file-size-kb <n>     Tamano maximo por archivo para escaneo (default: 2048)',
        '  --max-files <n>            Numero maximo de archivos a escanear (default: 12000)',
        '  --quiet                    Salida minima en consola',
        '  --help, -h                 Mostrar ayuda'
    ].join('\n');

    console.log(helpText);
}

function log(options, message) {
    if (!options.quiet) {
        console.log(message);
    }
}

function toPosixPath(filePath) {
    return filePath.split(path.sep).join('/');
}

function relPath(projectRoot, absPath) {
    return toPosixPath(path.relative(projectRoot, absPath));
}

function isEnvFile(fileName) {
    return fileName === '.env' || fileName.startsWith('.env.');
}

function isTextFile(fileName) {
    if (isEnvFile(fileName)) {
        return true;
    }

    const ext = path.extname(fileName).toLowerCase();
    if (TEXT_EXTENSIONS.has(ext)) {
        return true;
    }

    return fileName === 'Dockerfile' || fileName === 'package-lock.json' || fileName === 'yarn.lock';
}

function isCodeFile(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    return CODE_EXTENSIONS.has(ext);
}

function isMarkdownFile(fileName) {
    return path.extname(fileName).toLowerCase() === '.md';
}

function shouldSkipDirectory(absPath, rel) {
    const name = path.basename(absPath);
    if (EXCLUDED_DIRS.has(name)) {
        return true;
    }

    if (rel.startsWith('backend/uploads') || rel.startsWith('respaldos-godaddy')) {
        return true;
    }

    return false;
}

function walkFiles(projectRoot, options) {
    const results = [];

    function visit(currentPath) {
        if (results.length >= options.maxFiles) {
            return;
        }

        let entries;
        try {
            entries = fs.readdirSync(currentPath, { withFileTypes: true });
        } catch (_err) {
            return;
        }

        for (const entry of entries) {
            if (results.length >= options.maxFiles) {
                return;
            }

            const abs = path.join(currentPath, entry.name);
            const rel = relPath(projectRoot, abs);

            if (rel === 'scripts/security-audit.js') {
                continue;
            }

            if (entry.isDirectory()) {
                if (shouldSkipDirectory(abs, rel)) {
                    continue;
                }
                visit(abs);
                continue;
            }

            if (!entry.isFile()) {
                continue;
            }

            if (!isTextFile(entry.name)) {
                continue;
            }

            let stats;
            try {
                stats = fs.statSync(abs);
            } catch (_err) {
                continue;
            }

            if (stats.size > options.maxFileSizeKb * 1024) {
                continue;
            }

            results.push({ abs, rel, size: stats.size });
        }
    }

    visit(projectRoot);
    return results;
}

function readTextFileSafe(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (_err) {
        return '';
    }
}

function indexToLine(content, index) {
    if (index <= 0) {
        return 1;
    }
    let line = 1;
    for (let i = 0; i < index; i += 1) {
        if (content.charCodeAt(i) === 10) {
            line += 1;
        }
    }
    return line;
}

function getLine(lines, lineNumber) {
    if (lineNumber <= 0 || lineNumber > lines.length) {
        return '';
    }
    return lines[lineNumber - 1] || '';
}

function cleanEvidence(text) {
    if (!text) {
        return '';
    }
    const oneLine = String(text).replace(/\s+/g, ' ').trim();
    if (oneLine.length <= 220) {
        return oneLine;
    }
    return `${oneLine.slice(0, 217)}...`;
}

function maskSecret(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) {
        return '[empty]';
    }
    if (value.length <= 8) {
        return '*'.repeat(value.length);
    }
    return `${value.slice(0, 4)}...${value.slice(-3)} (${value.length} chars)`;
}

function addFinding(report, finding) {
    const normalized = {
        id: finding.id,
        title: finding.title,
        severity: finding.severity,
        category: finding.category,
        file: finding.file || '-',
        line: Number.isFinite(finding.line) ? finding.line : 1,
        evidence: cleanEvidence(finding.evidence || ''),
        recommendation: finding.recommendation || 'Revisar manualmente este hallazgo.'
    };

    const key = `${normalized.id}|${normalized.file}|${normalized.line}|${normalized.evidence}`;
    if (report.findingKeys.has(key)) {
        return;
    }

    report.findingKeys.add(key);
    report.findings.push(normalized);
}

function getTrackedFiles(projectRoot) {
    const out = new Set();
    const result = spawnSync('git', ['ls-files'], {
        cwd: projectRoot,
        encoding: 'utf8',
        timeout: 15000
    });

    if (result.error || result.status !== 0 || !result.stdout) {
        return out;
    }

    const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
        out.add(toPosixPath(line));
    }

    return out;
}

function scanSecretsInLine({ lineText, fileRel, lineNumber, trackedFiles, report }) {
    if (isMarkdownFile(fileRel)) {
        return;
    }

    const fileBase = path.basename(fileRel);
    const envLike = isEnvFile(fileBase);

    const pairMatch = lineText.match(/^\s*([A-Z0-9_]{3,})\s*=\s*(.+)\s*$/);
    if (pairMatch) {
        const key = pairMatch[1];
        const rawValue = pairMatch[2].replace(/^['"]|['"]$/g, '');
        const secretKey = /(SECRET|TOKEN|PASS|PASSWORD|PRIVATE_KEY|API_KEY|JWT)/i.test(key);
        const looksRealSecret = rawValue.length >= 16 && !/(CAMBIA|CHANGE|PLACEHOLDER|xxxx|xxxxx|tu_|example|cambiaste|aleatorio)/i.test(rawValue);

        if (secretKey && looksRealSecret) {
            const tracked = trackedFiles.has(fileRel);
            addFinding(report, {
                id: 'SEC-001',
                title: tracked ? 'Secreto expuesto en archivo versionado' : 'Secreto detectado en archivo de entorno',
                severity: tracked ? 'critical' : 'high',
                category: 'secrets',
                file: fileRel,
                line: lineNumber,
                evidence: `${key}=${maskSecret(rawValue)}`,
                recommendation: tracked
                    ? 'Rotar este secreto de inmediato, limpiar historial git y mover credenciales a variables seguras.'
                    : 'Verificar que este archivo no se publique ni se copie a repositorios/remotos inseguros.'
            });
        }
    }

    const googleClientSecret = lineText.match(/\bGOCSPX-[A-Za-z0-9_-]{10,}\b/);
    if (googleClientSecret) {
        addFinding(report, {
            id: 'SEC-002',
            title: 'Google OAuth client secret detectado',
            severity: trackedFiles.has(fileRel) ? 'critical' : 'high',
            category: 'secrets',
            file: fileRel,
            line: lineNumber,
            evidence: maskSecret(googleClientSecret[0]),
            recommendation: 'Rotar credenciales OAuth en Google Cloud Console y usar secretos fuera del codigo.'
        });
    }

    const refreshToken = lineText.match(/\b1\/\/[A-Za-z0-9._-]{20,}\b/);
    if (refreshToken) {
        addFinding(report, {
            id: 'SEC-003',
            title: 'Refresh token detectado',
            severity: trackedFiles.has(fileRel) ? 'critical' : 'high',
            category: 'secrets',
            file: fileRel,
            line: lineNumber,
            evidence: maskSecret(refreshToken[0]),
            recommendation: 'Revocar y regenerar el refresh token inmediatamente.'
        });
    }

    if (!envLike
        && /(password|contrase(?:n|ñ)a)\s*[:=]\s*['"][^'"]{8,}['"]/i.test(lineText)
        && !/tu_password|placeholder|example/i.test(lineText)
        && !/\$\{/.test(lineText)
        && !/data-password/i.test(lineText)) {
        addFinding(report, {
            id: 'SEC-004',
            title: 'Posible password hardcodeada',
            severity: 'medium',
            category: 'secrets',
            file: fileRel,
            line: lineNumber,
            evidence: lineText,
            recommendation: 'Evitar credenciales hardcodeadas, usar vault o variables de entorno.'
        });
    }
}

function scanSqlInjectionPatterns({ content, lines, fileRel, report }) {
    const sqlTemplateRegex = /(query|execute)\s*\(\s*`[^`]*\$\{[^`]+\}[^`]*`\s*(?:,|\))/gi;
    let match;

    while ((match = sqlTemplateRegex.exec(content)) !== null) {
        const chunk = match[0];
        if (!/\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|ORDER\s+BY|LIMIT|JOIN)\b/i.test(chunk)) {
            continue;
        }

        const lineNumber = indexToLine(content, match.index);
        addFinding(report, {
            id: 'SQL-001',
            title: 'SQL dinamico con interpolacion de template literal',
            severity: 'high',
            category: 'sql-injection',
            file: fileRel,
            line: lineNumber,
            evidence: getLine(lines, lineNumber),
            recommendation: 'Usar placeholders (?) y listas permitidas (allowlist) para cualquier parte dinamica del SQL.'
        });
    }

    const sqlConcatRegex = /(query|execute)\s*\(\s*(?:'[^']*'|"[^"]*"|`[^`]*`)\s*\+/gi;
    while ((match = sqlConcatRegex.exec(content)) !== null) {
        const lineNumber = indexToLine(content, match.index);
        const line = getLine(lines, lineNumber);
        if (!/\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|ORDER\s+BY|LIMIT|JOIN)\b/i.test(line)) {
            continue;
        }

        addFinding(report, {
            id: 'SQL-002',
            title: 'SQL construido por concatenacion',
            severity: 'high',
            category: 'sql-injection',
            file: fileRel,
            line: lineNumber,
            evidence: line,
            recommendation: 'No concatenar SQL con datos variables; parametrizar consultas.'
        });
    }

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const queryVarMatch = line.match(/(query|execute)\s*\(\s*([a-zA-Z_$][\w$]*)\s*(?:,|\))/i);
        if (queryVarMatch) {
            const varName = queryVarMatch[2] || '';
            const hasSecondArg = /(query|execute)\s*\(\s*[a-zA-Z_$][\w$]*\s*,\s*[a-zA-Z_$][\w$]*/i.test(line);
            const suspiciousVar = /^(whereSql|rawSql|unsafeSql|dynamicSql|orderBySql|sortBySql)$/i.test(varName);
            if (hasSecondArg && !suspiciousVar) {
                continue;
            }

            addFinding(report, {
                id: 'SQL-003',
                title: 'Query ejecutada desde variable dinamica',
                severity: 'low',
                category: 'sql-injection',
                file: fileRel,
                line: i + 1,
                evidence: line,
                recommendation: 'Verificar que la variable SQL no incluya input de usuario sin validacion estricta.'
            });
        }

        if (/UPDATE\s+\w+\s+SET\s+\$\{.*\}/i.test(line) || /WHERE\s+.*\$\{.*\}/i.test(line)) {
            addFinding(report, {
                id: 'SQL-004',
                title: 'Interpolacion directa en clausulas SQL',
                severity: 'high',
                category: 'sql-injection',
                file: fileRel,
                line: i + 1,
                evidence: line,
                recommendation: 'Mover clausulas dinamicas a allowlists fijas y evitar interpolacion directa.'
            });
        }
    }
}

function scanCodeExecutionPatterns({ lines, fileRel, report }) {
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];

        if (/\beval\s*\(|new\s+Function\s*\(/.test(line)) {
            addFinding(report, {
                id: 'RCE-001',
                title: 'Uso de eval/new Function',
                severity: 'high',
                category: 'code-execution',
                file: fileRel,
                line: i + 1,
                evidence: line,
                recommendation: 'Eliminar ejecucion dinamica de codigo; usar estructuras declarativas seguras.'
            });
        }

        if (/\bchild_process\.(exec|execSync|spawn|spawnSync|fork)\s*\(|(?:^|[^.\w$])(exec|execSync|spawn|spawnSync|fork)\s*\(/.test(line)) {
            const dynamic = /\$\{|\+\s*|req\.(body|query|params)|process\.argv/i.test(line);
            addFinding(report, {
                id: dynamic ? 'RCE-002' : 'RCE-003',
                title: dynamic ? 'Posible command injection en child_process' : 'Uso de child_process',
                severity: dynamic ? 'high' : 'medium',
                category: 'code-execution',
                file: fileRel,
                line: i + 1,
                evidence: line,
                recommendation: dynamic
                    ? 'Nunca pasar input de usuario a comandos del sistema; usar listas permitidas y escapes seguros.'
                    : 'Revisar que no se ejecuten comandos con input controlable por usuarios.'
            });
        }
    }
}

function scanPathTraversalPatterns({ lines, fileRel, report }) {
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];

        if (/path\.join\([^\n]*req\.(params|query|body)/i.test(line) || /fs\.(readFile|writeFile|createReadStream|createWriteStream)\([^\n]*req\.(params|query|body)/i.test(line)) {
            addFinding(report, {
                id: 'PATH-001',
                title: 'Posible path traversal por uso de input en rutas de archivo',
                severity: 'high',
                category: 'path-traversal',
                file: fileRel,
                line: i + 1,
                evidence: line,
                recommendation: 'Validar y normalizar rutas con allowlist, bloquear .. y rutas absolutas.'
            });
        }
    }
}

function scanJwtPatterns({ content, lines, fileRel, report }) {
    let match;
    const verifyRegex = /jwt\.verify\s*\(([^)]*)\)/g;
    while ((match = verifyRegex.exec(content)) !== null) {
        const argsText = match[1];
        const lineNumber = indexToLine(content, match.index);
        const hasAlgorithmConstraint = /algorithms\s*:/i.test(argsText);

        if (!hasAlgorithmConstraint) {
            addFinding(report, {
                id: 'JWT-001',
                title: 'jwt.verify sin restriccion explicita de algoritmos',
                severity: 'medium',
                category: 'auth',
                file: fileRel,
                line: lineNumber,
                evidence: getLine(lines, lineNumber),
                recommendation: 'Agregar options.algorithms (ej. ["HS256"]) para evitar algoritmos no esperados.'
            });
        }
    }

    const signRegex = /jwt\.sign\s*\(([^)]*)\)/g;
    while ((match = signRegex.exec(content)) !== null) {
        const argsText = match[1];
        const lineNumber = indexToLine(content, match.index);

        if (!/algorithm\s*:/i.test(argsText)) {
            addFinding(report, {
                id: 'JWT-002',
                title: 'jwt.sign sin algoritmo explicito',
                severity: 'low',
                category: 'auth',
                file: fileRel,
                line: lineNumber,
                evidence: getLine(lines, lineNumber),
                recommendation: 'Definir algorithm explicito en jwt.sign para endurecer consistencia criptografica.'
            });
        }
    }

    for (let i = 0; i < lines.length; i += 1) {
        if (/req\.query\.token/.test(lines[i])) {
            addFinding(report, {
                id: 'JWT-003',
                title: 'Token recibido por query string',
                severity: 'low',
                category: 'auth',
                file: fileRel,
                line: i + 1,
                evidence: lines[i],
                recommendation: 'Evitar tokens en URL; preferir header Authorization o cookies httpOnly seguras.'
            });
        }
    }
}

function scanCorsAndHeaders({ lines, fileRel, report }) {
    const content = lines.join('\n');

    if (/cors\s*\(\s*\{[\s\S]{0,400}?origin\s*:\s*['"`]\*['"`][\s\S]{0,400}?credentials\s*:\s*true/i.test(content)) {
        addFinding(report, {
            id: 'HTTP-001',
            title: 'CORS wildcard con credentials=true',
            severity: 'critical',
            category: 'http-hardening',
            file: fileRel,
            line: 1,
            evidence: 'origin: "*" con credentials: true',
            recommendation: 'Configurar CORS con allowlist de dominios exactos y nunca usar * con credenciales.'
        });
    }

    if (/express\.json\s*\(\s*\{\s*limit\s*:\s*['"]([3-9][0-9]|[1-9][0-9]{2,})mb['"]/i.test(content)) {
        addFinding(report, {
            id: 'HTTP-002',
            title: 'Limite de body muy alto en express.json',
            severity: 'medium',
            category: 'http-hardening',
            file: fileRel,
            line: 1,
            evidence: 'express.json limit alto',
            recommendation: 'Reducir limites de payload por endpoint para mitigar riesgo DoS.'
        });
    }
}

function scanFile(file, content, report, trackedFiles) {
    const lines = content.split(/\r?\n/);
    const codeLike = isCodeFile(file.abs);

    if (codeLike) {
        scanSqlInjectionPatterns({ content, lines, fileRel: file.rel, report });
        scanCodeExecutionPatterns({ lines, fileRel: file.rel, report });
        scanPathTraversalPatterns({ lines, fileRel: file.rel, report });
        scanJwtPatterns({ content, lines, fileRel: file.rel, report });
        scanCorsAndHeaders({ lines, fileRel: file.rel, report });
    }

    for (let i = 0; i < lines.length; i += 1) {
        scanSecretsInLine({
            lineText: lines[i],
            fileRel: file.rel,
            lineNumber: i + 1,
            trackedFiles,
            report
        });
    }
}

function analyzeProjectWide(projectRoot, report, trackedFiles) {
    const serverPath = path.join(projectRoot, 'backend', 'server.js');
    if (fs.existsSync(serverPath)) {
        const rel = relPath(projectRoot, serverPath);
        const content = readTextFileSafe(serverPath);

        const hasHelmet = Boolean(content && /\bhelmet\b/.test(content));
        const hasManualHardening = Boolean(
            content
            && /X-Frame-Options/.test(content)
            && /Content-Security-Policy/.test(content)
            && /X-Content-Type-Options/.test(content)
            && /Referrer-Policy/.test(content)
        );

        if (content && !hasHelmet && !hasManualHardening) {
            addFinding(report, {
                id: 'CFG-001',
                title: 'Helmet no esta habilitado en Express',
                severity: 'medium',
                category: 'http-hardening',
                file: rel,
                line: 1,
                evidence: 'No se detecto uso de helmet()',
                recommendation: 'Agregar helmet con configuracion compatible para robustecer cabeceras HTTP.'
            });
        }

        if (content && !/app\.disable\(\s*['"]x-powered-by['"]\s*\)/.test(content)) {
            addFinding(report, {
                id: 'CFG-002',
                title: 'x-powered-by no esta deshabilitado',
                severity: 'low',
                category: 'http-hardening',
                file: rel,
                line: 1,
                evidence: 'No se detecto app.disable("x-powered-by")',
                recommendation: 'Deshabilitar x-powered-by para reducir exposicion de fingerprinting del servidor.'
            });
        }

        if (content && !/rateLimit\s*\(/.test(content)) {
            addFinding(report, {
                id: 'CFG-003',
                title: 'No se detecto rate limiting',
                severity: 'high',
                category: 'auth',
                file: rel,
                line: 1,
                evidence: 'No se encontro rateLimit()',
                recommendation: 'Agregar rate limit al menos en login, reset password y endpoints sensibles.'
            });
        }
    }

    const gitIgnorePath = path.join(projectRoot, '.gitignore');
    if (fs.existsSync(gitIgnorePath)) {
        const ignoreContent = readTextFileSafe(gitIgnorePath);
        const ignoreLines = ignoreContent
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('#'));
        const mustIgnore = ['backend/.env', 'backend/.env.produccion', '.env'];

        const hasIgnore = (pattern) => {
            return ignoreLines.some((line) => {
                if (line.startsWith('!')) {
                    return false;
                }

                const normalized = line
                    .replace(/\\/g, '/')
                    .replace(/^\/+/, '');

                if (normalized === pattern) {
                    return true;
                }

                if (normalized.endsWith('/.env.*') && pattern.startsWith(normalized.slice(0, -2))) {
                    return true;
                }

                return false;
            });
        };

        for (const pattern of mustIgnore) {
            if (!hasIgnore(pattern)) {
                addFinding(report, {
                    id: 'CFG-004',
                    title: 'Falta regla de ignore para archivo sensible',
                    severity: 'high',
                    category: 'secrets',
                    file: '.gitignore',
                    line: 1,
                    evidence: pattern,
                    recommendation: `Agregar ${pattern} en .gitignore para evitar fuga de secretos.`
                });
            }
        }
    }

    const sensitiveCandidates = [
        'backend/.env',
        'backend/.env.produccion',
        '.env',
        'backend/google-credentials.json'
    ];

    for (const candidate of sensitiveCandidates) {
        const abs = path.join(projectRoot, candidate);
        if (!fs.existsSync(abs)) {
            continue;
        }

        const tracked = trackedFiles.has(candidate);
        if (tracked) {
            addFinding(report, {
                id: 'SEC-005',
                title: 'Archivo sensible rastreado por git',
                severity: 'critical',
                category: 'secrets',
                file: candidate,
                line: 1,
                evidence: candidate,
                recommendation: 'Sacar archivo del control de versiones y rotar secretos asociados.'
            });
        }
    }
}

function mapNpmSeverity(sev) {
    if (!sev) {
        return 'info';
    }
    const s = String(sev).toLowerCase();
    if (s === 'moderate') {
        return 'medium';
    }
    if (Object.prototype.hasOwnProperty.call(SEVERITY_WEIGHT, s)) {
        return s;
    }
    return 'info';
}

function pickHighestSeverity(counts) {
    let best = 'info';
    for (const [severity, value] of Object.entries(counts)) {
        if (Number(value) > 0 && SEVERITY_WEIGHT[severity] > SEVERITY_WEIGHT[best]) {
            best = severity;
        }
    }
    return best;
}

function runNpmAudit(cwd, label) {
    const manifestPath = path.join(cwd, 'package.json');
    if (!fs.existsSync(manifestPath)) {
        return null;
    }

    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = spawnSync(npmCmd, ['audit', '--json'], {
        cwd,
        encoding: 'utf8',
        timeout: 180000,
        maxBuffer: 20 * 1024 * 1024,
        env: {
            ...process.env,
            npm_config_loglevel: 'silent'
        }
    });

    const raw = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    if (!raw) {
        const reason = result.error
            ? `${result.error.code || 'ERROR'}: ${result.error.message}`
            : `exitCode=${result.status}`;
        return {
            label,
            cwd,
            ok: false,
            error: `npm audit no devolvio salida procesable (${reason})`,
            counts: {
                critical: 0,
                high: 0,
                medium: 0,
                low: 0,
                info: 0
            },
            advisories: []
        };
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        const jsonStart = raw.indexOf('{');
        const jsonEnd = raw.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
            const sliced = raw.slice(jsonStart, jsonEnd + 1);
            try {
                parsed = JSON.parse(sliced);
            } catch (_err2) {
                parsed = null;
            }
        }
    }

    if (!parsed) {
        const shortRaw = cleanEvidence(raw);
        return {
            label,
            cwd,
            ok: false,
            error: `Salida de npm audit no es JSON valido: ${shortRaw}`,
            counts: {
                critical: 0,
                high: 0,
                medium: 0,
                low: 0,
                info: 0
            },
            advisories: []
        };
    }

    const counts = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0
    };

    const meta = parsed.metadata && parsed.metadata.vulnerabilities ? parsed.metadata.vulnerabilities : {};
    counts.info += Number(meta.info || 0);
    counts.low += Number(meta.low || 0);
    counts.medium += Number(meta.moderate || 0) + Number(meta.medium || 0);
    counts.high += Number(meta.high || 0);
    counts.critical += Number(meta.critical || 0);

    const advisories = [];
    if (parsed.vulnerabilities && typeof parsed.vulnerabilities === 'object') {
        for (const [pkg, vuln] of Object.entries(parsed.vulnerabilities)) {
            const severity = mapNpmSeverity(vuln && vuln.severity);
            let title = 'Vulnerabilidad en dependencia';
            if (Array.isArray(vuln && vuln.via)) {
                const viaObject = vuln.via.find((item) => item && typeof item === 'object' && item.title);
                if (viaObject && viaObject.title) {
                    title = viaObject.title;
                }
            }

            advisories.push({
                package: pkg,
                severity,
                title,
                fixAvailable: Boolean(vuln && vuln.fixAvailable)
            });
        }
    }

    advisories.sort((a, b) => {
        const diff = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
        if (diff !== 0) {
            return diff;
        }
        return a.package.localeCompare(b.package);
    });

    return {
        label,
        cwd,
        ok: true,
        counts,
        highestSeverity: pickHighestSeverity(counts),
        advisories: advisories.slice(0, 40),
        exitCode: result.status
    };
}

function sortFindings(findings) {
    findings.sort((a, b) => {
        const severityDiff = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
        if (severityDiff !== 0) {
            return severityDiff;
        }
        const fileDiff = a.file.localeCompare(b.file);
        if (fileDiff !== 0) {
            return fileDiff;
        }
        return a.line - b.line;
    });
}

function computeSummary(report) {
    const bySeverity = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0
    };

    const byCategory = {};
    for (const finding of report.findings) {
        bySeverity[finding.severity] += 1;
        byCategory[finding.category] = (byCategory[finding.category] || 0) + 1;
    }

    let highestSeverity = 'info';
    for (const [severity, count] of Object.entries(bySeverity)) {
        if (count > 0 && SEVERITY_WEIGHT[severity] > SEVERITY_WEIGHT[highestSeverity]) {
            highestSeverity = severity;
        }
    }

    report.summary = {
        filesScanned: report.filesScanned,
        findingsTotal: report.findings.length,
        bySeverity,
        byCategory,
        highestSeverity
    };
}

function shouldFail(report, failOn) {
    if (failOn === 'none') {
        return false;
    }

    const threshold = SEVERITY_WEIGHT[failOn];
    return report.findings.some((finding) => SEVERITY_WEIGHT[finding.severity] >= threshold);
}

function buildMarkdown(report) {
    const lines = [];
    lines.push('# Reporte de Auditoria de Ciberseguridad');
    lines.push('');
    lines.push(`- Fecha: ${report.generatedAt}`);
    lines.push(`- Proyecto: ${report.projectRoot}`);
    lines.push(`- Version herramienta: ${TOOL_VERSION}`);
    lines.push(`- Archivos escaneados: ${report.summary.filesScanned}`);
    lines.push('');
    lines.push('## Resumen por severidad');
    lines.push('');
    lines.push('| Severidad | Hallazgos |');
    lines.push('|---|---:|');
    lines.push(`| Critical | ${report.summary.bySeverity.critical} |`);
    lines.push(`| High | ${report.summary.bySeverity.high} |`);
    lines.push(`| Medium | ${report.summary.bySeverity.medium} |`);
    lines.push(`| Low | ${report.summary.bySeverity.low} |`);
    lines.push(`| Info | ${report.summary.bySeverity.info} |`);
    lines.push('');

    if (report.dependencyAudits.length > 0) {
        lines.push('## Dependencias (npm audit)');
        lines.push('');
        lines.push('| Scope | Critical | High | Medium | Low | Info | Estado |');
        lines.push('|---|---:|---:|---:|---:|---:|---|');
        for (const dep of report.dependencyAudits) {
            if (!dep) {
                continue;
            }
            const status = dep.ok ? 'OK' : `ERROR: ${dep.error}`;
            lines.push(`| ${dep.label} | ${dep.counts.critical} | ${dep.counts.high} | ${dep.counts.medium} | ${dep.counts.low} | ${dep.counts.info} | ${status} |`);
        }
        lines.push('');
    }

    lines.push('## Hallazgos');
    lines.push('');

    if (report.findings.length === 0) {
        lines.push('No se detectaron hallazgos con las reglas actuales.');
        lines.push('');
    } else {
        for (const finding of report.findings) {
            lines.push(`### [${finding.severity.toUpperCase()}] ${finding.id} - ${finding.title}`);
            lines.push(`- Archivo: ${finding.file}:${finding.line}`);
            lines.push(`- Categoria: ${finding.category}`);
            lines.push(`- Evidencia: ${finding.evidence || '-'}`);
            lines.push(`- Recomendacion: ${finding.recommendation}`);
            lines.push('');
        }
    }

    return `${lines.join('\n')}\n`;
}

function writeReports(report, options) {
    fs.mkdirSync(options.outDir, { recursive: true });

    const jsonPath = path.join(options.outDir, 'security-audit-report.json');
    const mdPath = path.join(options.outDir, 'security-audit-report.md');

    if (options.format === 'json' || options.format === 'both') {
        fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    }

    if (options.format === 'md' || options.format === 'both') {
        fs.writeFileSync(mdPath, buildMarkdown(report), 'utf8');
    }

    return {
        jsonPath,
        mdPath
    };
}

function main() {
    let options;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(`[ERROR] ${err.message}`);
        printHelp();
        process.exit(1);
    }

    const projectRoot = options.projectRoot;
    if (!fs.existsSync(projectRoot)) {
        console.error(`[ERROR] Ruta de proyecto no existe: ${projectRoot}`);
        process.exit(1);
    }

    const report = {
        generatedAt: new Date().toISOString(),
        toolVersion: TOOL_VERSION,
        projectRoot,
        options: {
            format: options.format,
            skipDeps: options.skipDeps,
            failOn: options.failOn,
            maxFileSizeKb: options.maxFileSizeKb,
            maxFiles: options.maxFiles
        },
        filesScanned: 0,
        findings: [],
        findingKeys: new Set(),
        dependencyAudits: [],
        summary: {}
    };

    log(options, '[audit] Recolectando archivos para escaneo...');
    const trackedFiles = getTrackedFiles(projectRoot);
    const files = walkFiles(projectRoot, options);
    report.filesScanned = files.length;

    log(options, `[audit] Archivos a escanear: ${files.length}`);

    for (const file of files) {
        const content = readTextFileSafe(file.abs);
        if (!content) {
            continue;
        }
        scanFile(file, content, report, trackedFiles);
    }

    analyzeProjectWide(projectRoot, report, trackedFiles);

    if (!options.skipDeps) {
        log(options, '[audit] Ejecutando npm audit (root)...');
        const rootAudit = runNpmAudit(projectRoot, 'root');
        if (rootAudit) {
            report.dependencyAudits.push(rootAudit);
            if (rootAudit.ok && (rootAudit.counts.critical + rootAudit.counts.high + rootAudit.counts.medium + rootAudit.counts.low + rootAudit.counts.info > 0)) {
                addFinding(report, {
                    id: 'DEP-001',
                    title: `Dependencias vulnerables detectadas en ${rootAudit.label}`,
                    severity: rootAudit.highestSeverity || 'medium',
                    category: 'dependencies',
                    file: 'package.json',
                    line: 1,
                    evidence: JSON.stringify(rootAudit.counts),
                    recommendation: 'Ejecutar npm audit fix y revisar manualmente vulnerabilidades sin fix automatico.'
                });
            }
            if (!rootAudit.ok) {
                addFinding(report, {
                    id: 'DEP-ERR',
                    title: `No se pudo procesar npm audit en ${rootAudit.label}`,
                    severity: 'low',
                    category: 'dependencies',
                    file: 'package.json',
                    line: 1,
                    evidence: rootAudit.error,
                    recommendation: 'Verificar conectividad y version de npm para habilitar auditoria de dependencias.'
                });
            }
        }

        const backendPath = path.join(projectRoot, 'backend');
        if (fs.existsSync(path.join(backendPath, 'package.json'))) {
            log(options, '[audit] Ejecutando npm audit (backend)...');
            const backendAudit = runNpmAudit(backendPath, 'backend');
            if (backendAudit) {
                report.dependencyAudits.push(backendAudit);
                if (backendAudit.ok && (backendAudit.counts.critical + backendAudit.counts.high + backendAudit.counts.medium + backendAudit.counts.low + backendAudit.counts.info > 0)) {
                    addFinding(report, {
                        id: 'DEP-002',
                        title: `Dependencias vulnerables detectadas en ${backendAudit.label}`,
                        severity: backendAudit.highestSeverity || 'medium',
                        category: 'dependencies',
                        file: 'backend/package.json',
                        line: 1,
                        evidence: JSON.stringify(backendAudit.counts),
                        recommendation: 'Actualizar dependencias backend y aplicar fixes de seguridad prioritarias.'
                    });
                }
                if (!backendAudit.ok) {
                    addFinding(report, {
                        id: 'DEP-ERR',
                        title: `No se pudo procesar npm audit en ${backendAudit.label}`,
                        severity: 'low',
                        category: 'dependencies',
                        file: 'backend/package.json',
                        line: 1,
                        evidence: backendAudit.error,
                        recommendation: 'Verificar lockfile backend y acceso a registro npm.'
                    });
                }
            }
        }
    }

    sortFindings(report.findings);
    computeSummary(report);

    const paths = writeReports(report, options);

    log(options, '[audit] Auditoria finalizada.');
    console.log('');
    console.log('=== SECURITY AUDIT SUMMARY ===');
    console.log(`Files scanned : ${report.summary.filesScanned}`);
    console.log(`Findings total: ${report.summary.findingsTotal}`);
    console.log(`Critical      : ${report.summary.bySeverity.critical}`);
    console.log(`High          : ${report.summary.bySeverity.high}`);
    console.log(`Medium        : ${report.summary.bySeverity.medium}`);
    console.log(`Low           : ${report.summary.bySeverity.low}`);
    console.log(`Info          : ${report.summary.bySeverity.info}`);
    console.log('');
    console.log(`JSON report: ${toPosixPath(path.relative(projectRoot, paths.jsonPath))}`);
    console.log(`MD report  : ${toPosixPath(path.relative(projectRoot, paths.mdPath))}`);

    if (shouldFail(report, options.failOn)) {
        console.log(`\nResultado: FAIL (hallazgos >= ${options.failOn})`);
        process.exitCode = 2;
    } else {
        console.log('\nResultado: PASS');
        process.exitCode = 0;
    }
}

main();
