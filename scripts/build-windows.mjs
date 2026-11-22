// Build standalone Windows x64 GUI installer (.exe) for AGY Quota Rings.
// - On Windows with .NET Framework csc.exe: compiles SetupProgram.cs + WatcherProgram.cs directly.
// - On macOS/Linux: emits a genuine Windows x64 PE32+ GUI executable (IMAGE_SUBSYSTEM_WINDOWS_GUI)
//   with embedded multi-size ICO icon (.rsrc) and self-extracting payload that compiles & opens
//   the native WinForms GUI using Windows's built-in .NET Framework 4.x (zero Node.js needed).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { buildIco } from './icon-gen.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
const VERSION = pkg.version || '1.1.0';

// ── Minimal ZIP archive builder (Store / Deflate, standard PKZIP) ────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const compressed = zlib.deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0800, 6); // UTF-8
    lh.writeUInt16LE(8, 8); // Deflate
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(compressed.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);

    localParts.push(lh, nameBuf, compressed);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(compressed.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);

    centralParts.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function alignUp(val, align) {
  return Math.ceil(val / align) * align;
}

// ── PE32+ .rsrc Section Builder (RT_ICON + RT_GROUP_ICON from ICO) ───────────
function buildIconResourceSection(icoBuf, rsrcRva) {
  const count = icoBuf.readUInt16LE(4);
  const icons = [];
  const grpEntries = Buffer.alloc(6 + count * 14);
  grpEntries.writeUInt16LE(0, 0);
  grpEntries.writeUInt16LE(1, 2);
  grpEntries.writeUInt16LE(count, 4);

  for (let i = 0; i < count; i++) {
    const srcOff = 6 + i * 16;
    const bytesInRes = icoBuf.readUInt32LE(srcOff + 8);
    const imgOffset = icoBuf.readUInt32LE(srcOff + 12);
    icons.push({
      id: i + 1,
      data: icoBuf.subarray(imgOffset, imgOffset + bytesInRes),
    });

    const dstOff = 6 + i * 14;
    icoBuf.copy(grpEntries, dstOff, srcOff, srcOff + 12);
    grpEntries.writeUInt16LE(i + 1, dstOff + 12); // nID
  }

  // Resource tree layout:
  // Level 1 (root): 2 entries -> Type 3 (RT_ICON), Type 14 (RT_GROUP_ICON)
  // Level 2 (RT_ICON): count entries -> IDs 1..count
  // Level 2 (RT_GROUP_ICON): 1 entry -> ID 1
  // Level 3 (Lang 0x0409): 1 entry each for icons (count) + 1 for group icon
  // Data Entries (16 bytes each): count + 1
  // Raw resource payloads (4-byte aligned)

  const dirSize = (n) => 16 + n * 8;
  const offRoot = 0;
  const offTypeIcon = offRoot + dirSize(2);
  const offTypeGroup = offTypeIcon + dirSize(count);
  const offLangIconsStart = offTypeGroup + dirSize(1);
  const offLangGroup = offLangIconsStart + count * dirSize(1);
  const offDataEntriesStart = offLangGroup + dirSize(1);
  const offPayloadsStart = alignUp(offDataEntriesStart + (count + 1) * 16, 8);

  let payloadCursor = offPayloadsStart;
  const iconOffsets = [];
  for (const ic of icons) {
    iconOffsets.push(payloadCursor);
    payloadCursor = alignUp(payloadCursor + ic.data.length, 4);
  }
  const grpPayloadOff = payloadCursor;
  payloadCursor = alignUp(payloadCursor + grpEntries.length, 4);

  const buf = Buffer.alloc(payloadCursor);

  function writeDir(off, entries) {
    buf.writeUInt16LE(0, off + 12); // NumberOfNamedEntries
    buf.writeUInt16LE(entries.length, off + 14); // NumberOfIdEntries
    entries.forEach((e, idx) => {
      const eo = off + 16 + idx * 8;
      buf.writeUInt32LE(e.id >>> 0, eo);
      buf.writeUInt32LE((e.isDir ? (0x80000000 | e.target) : e.target) >>> 0, eo + 4);
    });
  }

  function writeDataEntry(off, dataOff, size) {
    buf.writeUInt32LE(rsrcRva + dataOff, off);
    buf.writeUInt32LE(size, off + 4);
    buf.writeUInt32LE(0, off + 8);
    buf.writeUInt32LE(0, off + 12);
  }

  // Root dir
  writeDir(offRoot, [
    { id: 3, isDir: true, target: offTypeIcon },
    { id: 14, isDir: true, target: offTypeGroup },
  ]);

  // RT_ICON dir
  writeDir(
    offTypeIcon,
    icons.map((ic, i) => ({ id: ic.id, isDir: true, target: offLangIconsStart + i * dirSize(1) }))
  );

  // RT_GROUP_ICON dir
  writeDir(offTypeGroup, [{ id: 1, isDir: true, target: offLangGroup }]);

  // Language dirs + Data entries + Payloads for icons
  for (let i = 0; i < icons.length; i++) {
    const langOff = offLangIconsStart + i * dirSize(1);
    const deOff = offDataEntriesStart + i * 16;
    writeDir(langOff, [{ id: 0x0409, isDir: false, target: deOff }]);
    writeDataEntry(deOff, iconOffsets[i], icons[i].data.length);
    icons[i].data.copy(buf, iconOffsets[i]);
  }

  // Language dir + Data entry + Payload for group icon
  const grpDeOff = offDataEntriesStart + count * 16;
  writeDir(offLangGroup, [{ id: 0x0409, isDir: false, target: grpDeOff }]);
  writeDataEntry(grpDeOff, grpPayloadOff, grpEntries.length);
  grpEntries.copy(buf, grpPayloadOff);

  return buf;
}

// ── Build Native Windows x64 PE32+ GUI Launcher Stub ─────────────────────────
function buildWin64GuiStub(icoBuf) {
  const FILE_ALIGN = 0x200;
  const SECT_ALIGN = 0x1000;
  const IMAGE_BASE = 0x0000000140000000n;

  const TEXT_RVA = 0x1000;
  const RDATA_RVA = 0x2000;
  const RSRC_RVA = 0x3000;

  // Command line executed silently via WinExec(..., SW_HIDE)
  // Construct delimiter via string concat so the literal marker never appears in .rdata
  const cmdStr =
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command ` +
    `"iex([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(([Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($env:AGY_QR_EXE)) -split ('~AGYQR'+'_'+'BOOT~'))[1])))"`;

  // Build .rdata layout:
  // 0x000: IAT (5 QWORDs = 40 bytes): GetModuleFileNameW, SetEnvironmentVariableW, WinExec, ExitProcess, 0
  // 0x030: Import Directory Table (2 * 20 = 40 bytes): KERNEL32 + null terminator
  // 0x060: ILT (5 QWORDs = 40 bytes)
  // 0x090: DLL name "KERNEL32.dll\0"
  // 0x0A0: Hint/Name entries
  // ...  : Wide string L"AGY_QR_EXE\0"
  // ...  : ASCII cmdStr\0
  const IAT_OFF = 0x00;
  const IDT_OFF = 0x30;
  const ILT_OFF = 0x60;
  const DLL_NAME_OFF = 0x90;

  const funcNames = [
    'GetModuleFileNameW',
    'SetEnvironmentVariableW',
    'WinExec',
    'ExitProcess',
  ];

  let cur = 0xa0;
  const hintOffsets = [];
  for (const fn of funcNames) {
    cur = alignUp(cur, 2);
    hintOffsets.push(cur);
    cur += 2 + fn.length + 1;
  }

  cur = alignUp(cur, 16);
  const VAR_NAME_OFF = cur;
  const varNameBuf = Buffer.from('AGY_QR_EXE\0', 'utf16le');
  cur += varNameBuf.length;

  cur = alignUp(cur, 16);
  const CMD_STR_OFF = cur;
  const cmdBuf = Buffer.from(cmdStr + '\0', 'ascii');
  cur += cmdBuf.length;

  const rdataRaw = Buffer.alloc(cur);
  // Write DLL name
  rdataRaw.write('KERNEL32.dll\0', DLL_NAME_OFF, 'ascii');
  // Write Hint/Name entries + ILT + IAT
  funcNames.forEach((fn, i) => {
    const hOff = hintOffsets[i];
    rdataRaw.writeUInt16LE(0, hOff);
    rdataRaw.write(fn + '\0', hOff + 2, 'ascii');
    const rva = BigInt(RDATA_RVA + hOff);
    rdataRaw.writeBigUInt64LE(rva, ILT_OFF + i * 8);
    rdataRaw.writeBigUInt64LE(rva, IAT_OFF + i * 8);
  });
  // Write IDT entry
  rdataRaw.writeUInt32LE(RDATA_RVA + ILT_OFF, IDT_OFF + 0); // OriginalFirstThunk
  rdataRaw.writeUInt32LE(0, IDT_OFF + 4);
  rdataRaw.writeUInt32LE(0, IDT_OFF + 8);
  rdataRaw.writeUInt32LE(RDATA_RVA + DLL_NAME_OFF, IDT_OFF + 12); // Name
  rdataRaw.writeUInt32LE(RDATA_RVA + IAT_OFF, IDT_OFF + 16); // FirstThunk

  varNameBuf.copy(rdataRaw, VAR_NAME_OFF);
  cmdBuf.copy(rdataRaw, CMD_STR_OFF);

  // Assemble .text (x86_64 Windows ABI, 75 bytes)
  const code = [];
  const emit = (...bytes) => code.push(...bytes);
  const emitI32 = (val) => {
    const b = Buffer.alloc(4);
    b.writeInt32LE(val, 0);
    code.push(b[0], b[1], b[2], b[3]);
  };
  const emitRelCallIat = (iatIdx) => {
    emit(0xff, 0x15);
    const nextRip = TEXT_RVA + code.length + 4;
    const target = RDATA_RVA + IAT_OFF + iatIdx * 8;
    emitI32(target - nextRip);
  };
  const emitLeaRcxRdata = (rdataOff) => {
    emit(0x48, 0x8d, 0x0d);
    const nextRip = TEXT_RVA + code.length + 4;
    const target = RDATA_RVA + rdataOff;
    emitI32(target - nextRip);
  };

  // sub rsp, 0x828 (keeps 16-byte alignment & < 4KB so no __chkstk needed)
  emit(0x48, 0x81, 0xec, 0x28, 0x08, 0x00, 0x00);
  // GetModuleFileNameW(NULL, &buf, 1024)
  emit(0x31, 0xc9); // xor ecx, ecx
  emit(0x48, 0x8d, 0x54, 0x24, 0x20); // lea rdx, [rsp+0x20]
  emit(0x41, 0xb8, 0x00, 0x04, 0x00, 0x00); // mov r8d, 1024
  emitRelCallIat(0);
  // SetEnvironmentVariableW(L"AGY_QR_EXE", &buf)
  emitLeaRcxRdata(VAR_NAME_OFF);
  emit(0x48, 0x8d, 0x54, 0x24, 0x20); // lea rdx, [rsp+0x20]
  emitRelCallIat(1);
  // WinExec(cmdStr, SW_HIDE=0)
  emitLeaRcxRdata(CMD_STR_OFF);
  emit(0x31, 0xd2); // xor edx, edx
  emitRelCallIat(2);
  // ExitProcess(0)
  emit(0x31, 0xc9); // xor ecx, ecx
  emitRelCallIat(3);
  // add rsp, 0x828; ret
  emit(0x48, 0x81, 0xc4, 0x28, 0x08, 0x00, 0x00);
  emit(0xc3);

  const textRaw = Buffer.from(code);
  const rsrcRaw = buildIconResourceSection(icoBuf, RSRC_RVA);

  const textFileSize = alignUp(textRaw.length, FILE_ALIGN);
  const rdataFileSize = alignUp(rdataRaw.length, FILE_ALIGN);
  const rsrcFileSize = alignUp(rsrcRaw.length, FILE_ALIGN);

  const headersSize = FILE_ALIGN; // 0x200
  const textFileOff = headersSize;
  const rdataFileOff = textFileOff + textFileSize;
  const rsrcFileOff = rdataFileOff + rdataFileSize;

  const rsrcVirtSize = rsrcRaw.length;
  const sizeOfImage = alignUp(RSRC_RVA + rsrcVirtSize, SECT_ALIGN);

  const hdr = Buffer.alloc(headersSize);

  // DOS Header (64 bytes)
  hdr.write('MZ', 0, 'ascii');
  hdr.writeUInt32LE(0x80, 0x3c); // e_lfanew = 0x80

  // PE Signature + COFF Header at 0x80
  const pe = 0x80;
  hdr.write('PE\0\0', pe, 'ascii');
  hdr.writeUInt16LE(0x8664, pe + 4); // Machine = AMD64
  hdr.writeUInt16LE(3, pe + 6); // NumberOfSections = 3
  hdr.writeUInt32LE(Math.floor(Date.now() / 1000), pe + 8);
  hdr.writeUInt16LE(0xf0, pe + 20); // SizeOfOptionalHeader = 240
  hdr.writeUInt16LE(0x0022, pe + 22); // EXECUTABLE_IMAGE | LARGE_ADDRESS_AWARE

  // Optional Header (PE32+, 240 bytes) at pe + 24 (0x98)
  const opt = pe + 24;
  hdr.writeUInt16LE(0x020b, opt + 0); // Magic = PE32+
  hdr[opt + 2] = 14;
  hdr[opt + 3] = 0;
  hdr.writeUInt32LE(textFileSize, opt + 4); // SizeOfCode
  hdr.writeUInt32LE(rdataFileSize + rsrcFileSize, opt + 8); // SizeOfInitializedData
  hdr.writeUInt32LE(TEXT_RVA, opt + 16); // AddressOfEntryPoint
  hdr.writeUInt32LE(TEXT_RVA, opt + 20); // BaseOfCode
  hdr.writeBigUInt64LE(IMAGE_BASE, opt + 24); // ImageBase
  hdr.writeUInt32LE(SECT_ALIGN, opt + 32); // SectionAlignment
  hdr.writeUInt32LE(FILE_ALIGN, opt + 36); // FileAlignment
  hdr.writeUInt16LE(6, opt + 40); // MajorOperatingSystemVersion
  hdr.writeUInt16LE(0, opt + 42);
  hdr.writeUInt16LE(6, opt + 48); // MajorSubsystemVersion
  hdr.writeUInt16LE(0, opt + 50);
  hdr.writeUInt32LE(sizeOfImage, opt + 56); // SizeOfImage
  hdr.writeUInt32LE(headersSize, opt + 60); // SizeOfHeaders
  hdr.writeUInt16LE(2, opt + 68); // Subsystem = IMAGE_SUBSYSTEM_WINDOWS_GUI
  hdr.writeUInt16LE(0x8160, opt + 70); // DllCharacteristics = HIGH_ENTROPY_VA | DYNAMIC_BASE | NX_COMPAT | TERMINAL_SERVER_AWARE
  hdr.writeBigUInt64LE(0x100000n, opt + 72); // SizeOfStackReserve
  hdr.writeBigUInt64LE(0x1000n, opt + 80); // SizeOfStackCommit
  hdr.writeBigUInt64LE(0x100000n, opt + 88); // SizeOfHeapReserve
  hdr.writeBigUInt64LE(0x1000n, opt + 96); // SizeOfHeapCommit
  hdr.writeUInt32LE(16, opt + 108); // NumberOfRvaAndSizes

  // Data Directories (opt + 112)
  const dd = opt + 112;
  // [1] Import Table
  hdr.writeUInt32LE(RDATA_RVA + IDT_OFF, dd + 1 * 8);
  hdr.writeUInt32LE(40, dd + 1 * 8 + 4);
  // [2] Resource Table
  hdr.writeUInt32LE(RSRC_RVA, dd + 2 * 8);
  hdr.writeUInt32LE(rsrcVirtSize, dd + 2 * 8 + 4);
  // [12] IAT
  hdr.writeUInt32LE(RDATA_RVA + IAT_OFF, dd + 12 * 8);
  hdr.writeUInt32LE(40, dd + 12 * 8 + 4);

  // Section Headers at opt + 240 (0x188)
  function writeSection(idx, name, virtSize, virtAddr, rawSize, rawPtr, chars) {
    const s = opt + 240 + idx * 40;
    hdr.write(name, s, 8, 'ascii');
    hdr.writeUInt32LE(virtSize, s + 8);
    hdr.writeUInt32LE(virtAddr, s + 12);
    hdr.writeUInt32LE(rawSize, s + 16);
    hdr.writeUInt32LE(rawPtr, s + 20);
    hdr.writeUInt32LE(chars >>> 0, s + 36);
  }

  writeSection(0, '.text', textRaw.length, TEXT_RVA, textFileSize, textFileOff, 0x60000020);
  writeSection(1, '.rdata', rdataRaw.length, RDATA_RVA, rdataFileSize, rdataFileOff, 0x40000040);
  writeSection(2, '.rsrc', rsrcVirtSize, RSRC_RVA, rsrcFileSize, rsrcFileOff, 0x40000040);

  const textPad = Buffer.alloc(textFileSize);
  textRaw.copy(textPad, 0);
  const rdataPad = Buffer.alloc(rdataFileSize);
  rdataRaw.copy(rdataPad, 0);
  const rsrcPad = Buffer.alloc(rsrcFileSize);
  rsrcRaw.copy(rsrcPad, 0);

  return Buffer.concat([hdr, textPad, rdataPad, rsrcPad]);
}

export function buildWindowsExe() {
  const distDir = path.join(ROOT_DIR, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  const exeName = `AGY-Quota-Rings-v${VERSION}-Windows-x64.exe`;
  const exeOut = path.join(distDir, exeName);

  const icoBuf = buildIco([16, 24, 32, 48, 64, 128, 256]);
  const quotaJs = fs.readFileSync(path.join(ROOT_DIR, 'src', 'quota-rings.js'));
  const setupCs = fs.readFileSync(path.join(ROOT_DIR, 'installer', 'windows', 'SetupProgram.cs'));
  const watcherCs = fs.readFileSync(path.join(ROOT_DIR, 'installer', 'windows', 'WatcherProgram.cs'));

  const payloadZip = buildZip([
    { name: 'quota-rings.js', data: quotaJs },
    { name: 'SetupProgram.cs', data: setupCs },
    { name: 'WatcherProgram.cs', data: watcherCs },
    { name: 'app.ico', data: icoBuf },
  ]);

  const bootPs1 = `
$ErrorActionPreference = 'Stop'
$exePath = $env:AGY_QR_EXE
if (-not $exePath -or -not (Test-Path $exePath)) { exit 1 }
$bytes = [IO.File]::ReadAllBytes($exePath)
$marker = [Text.Encoding]::ASCII.GetBytes('~AGYQR_ZIP~')
$idx = -1
for ($i = $bytes.Length - $marker.Length; $i -ge 0; $i--) {
  $match = $true
  for ($j = 0; $j -lt $marker.Length; $j++) {
    if ($bytes[$i + $j] -ne $marker[$j]) { $match = $false; break }
  }
  if ($match) { $idx = $i; break }
}
if ($idx -lt 0) { exit 2 }
$zipStart = $idx + $marker.Length
$zipLen = $bytes.Length - $zipStart
$zipBytes = New-Object byte[] $zipLen
[Array]::Copy($bytes, $zipStart, $zipBytes, 0, $zipLen)

$workDir = Join-Path $env:TEMP 'agy-quota-rings-setup-v${VERSION}'
New-Item -ItemType Directory -Path $workDir -Force | Out-Null
$zipFile = Join-Path $workDir 'payload.zip'
[IO.File]::WriteAllBytes($zipFile, $zipBytes)

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($zipFile)
try {
  foreach ($entry in $zip.Entries) {
    $dest = Join-Path $workDir $entry.Name
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true)
  }
} finally {
  $zip.Dispose()
}

$csc = Join-Path $env:WINDIR 'Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe'
if (-not (Test-Path $csc)) {
  $csc = Join-Path $env:WINDIR 'Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
}
$setupExe = Join-Path $workDir 'AGY-Quota-Rings-Setup.exe'
& $csc /nologo /utf8output /optimize+ /target:winexe ("/win32icon:" + (Join-Path $workDir 'app.ico')) ("/out:" + $setupExe) /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll (Join-Path $workDir 'SetupProgram.cs') | Out-Null
if (Test-Path $setupExe) {
  Start-Process -FilePath $setupExe -WorkingDirectory $workDir
}
`.trim();

  const stub = buildWin64GuiStub(icoBuf);
  const bootB64 = Buffer.from(bootPs1, 'utf8').toString('base64');
  const overlay = Buffer.concat([
    Buffer.from('~AGYQR_BOOT~', 'ascii'),
    Buffer.from(bootB64, 'ascii'),
    Buffer.from('~AGYQR_BOOT~', 'ascii'),
    Buffer.from('~AGYQR_ZIP~', 'ascii'),
    payloadZip,
  ]);

  const finalExe = Buffer.concat([stub, overlay]);
  fs.writeFileSync(exeOut, finalExe);
  console.log(`[✓] Built ${exeOut} (${(finalExe.length / 1024).toFixed(1)} KB)`);
  return exeOut;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  buildWindowsExe();
}
