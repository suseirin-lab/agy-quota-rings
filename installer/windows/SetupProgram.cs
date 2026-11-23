using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

namespace AgyQuotaRingsSetup
{
    internal static class Theme
    {
        public static bool IsLight()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                {
                    if (key != null)
                    {
                        object val = key.GetValue("AppsUseLightTheme");
                        if (val is int) return ((int)val) != 0;
                    }
                }
            }
            catch { }
            return false;
        }
    }

    internal sealed class DualRingIconControl : Control
    {
        public DualRingIconControl()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            var rect = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
            using (var path = RoundedRect(rect, 10f))
            using (var bg = new SolidBrush(Color.FromArgb(24, 28, 37)))
            using (var border = new Pen(Color.FromArgb(40, 255, 255, 255), 1f))
            {
                g.FillPath(bg, path);
                g.DrawPath(border, path);
            }

            DrawRing(g, Width / 2f, Height * 0.36f, 7.6f, 2.2f, 0.82f, Color.FromArgb(138, 180, 248));
            DrawRing(g, Width / 2f, Height * 0.72f, 5.0f, 1.9f, 0.88f, Color.FromArgb(129, 201, 149));
        }

        private static void DrawRing(Graphics g, float cx, float cy, float r, float stroke, float frac, Color color)
        {
            var box = new RectangleF(cx - r, cy - r, r * 2f, r * 2f);
            using (var trackPen = new Pen(Color.FromArgb(36, 255, 255, 255), stroke))
            {
                g.DrawEllipse(trackPen, box);
            }
            using (var arcPen = new Pen(color, stroke) { StartCap = LineCap.Round, EndCap = LineCap.Round })
            {
                g.DrawArc(arcPen, box, -90f, 360f * frac);
            }
        }

        public static GraphicsPath RoundedRect(RectangleF r, float radius)
        {
            float d = radius * 2f;
            var path = new GraphicsPath();
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }
    }

    internal sealed class ModeCard : Control
    {
        public string TitleText { get; set; }
        public string SubtitleText { get; set; }
        public string BadgeText { get; set; }
        public bool IsLight { get; set; }
        private bool _selected;
        private bool _hovered;

        public bool Selected
        {
            get { return _selected; }
            set { _selected = value; Invalidate(); }
        }

        public ModeCard()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
            Cursor = Cursors.Hand;
            BackColor = Color.Transparent;
        }

        protected override void OnMouseEnter(EventArgs e) { _hovered = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { _hovered = false; Invalidate(); base.OnMouseLeave(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

            Color accent = IsLight ? Color.FromArgb(26, 115, 232) : Color.FromArgb(138, 180, 248);
            Color fg = IsLight ? Color.FromArgb(32, 33, 36) : Color.FromArgb(232, 234, 237);
            Color muted = IsLight ? Color.FromArgb(95, 99, 104) : Color.FromArgb(154, 160, 166);
            Color fill = _selected
                ? (IsLight ? Color.FromArgb(255, 255, 255) : Color.FromArgb(32, 36, 46))
                : (_hovered
                    ? (IsLight ? Color.FromArgb(245, 247, 250) : Color.FromArgb(28, 31, 40))
                    : (IsLight ? Color.FromArgb(249, 250, 252) : Color.FromArgb(24, 27, 35)));
            Color border = _selected
                ? accent
                : (IsLight ? Color.FromArgb(218, 220, 224) : Color.FromArgb(52, 57, 68));

            var rect = new RectangleF(1f, 1f, Width - 2.5f, Height - 2.5f);
            using (var path = DualRingIconControl.RoundedRect(rect, 11f))
            using (var br = new SolidBrush(fill))
            using (var pen = new Pen(border, _selected ? 1.5f : 1f))
            {
                g.FillPath(br, path);
                g.DrawPath(pen, path);
            }

            // Radio circle
            float rcx = 20f, rcy = Height / 2f;
            using (var rPen = new Pen(_selected ? accent : muted, 1.6f))
            {
                g.DrawEllipse(rPen, rcx - 6.5f, rcy - 6.5f, 13f, 13f);
            }
            if (_selected)
            {
                using (var dotBr = new SolidBrush(accent))
                {
                    g.FillEllipse(dotBr, rcx - 3.3f, rcy - 3.3f, 6.6f, 6.6f);
                }
            }

            using (var titleFont = new Font("Microsoft YaHei UI", 9.2f, FontStyle.Bold))
            using (var subFont = new Font("Microsoft YaHei UI", 8.2f, FontStyle.Regular))
            using (var fgBr = new SolidBrush(fg))
            using (var mutedBr = new SolidBrush(muted))
            {
                var titlePos = new PointF(38f, 10f);
                g.DrawString(TitleText ?? "", titleFont, fgBr, titlePos);

                if (!string.IsNullOrEmpty(BadgeText))
                {
                    SizeF ts = g.MeasureString(TitleText ?? "", titleFont);
                    using (var badgeFont = new Font("Microsoft YaHei UI", 7.4f, FontStyle.Regular))
                    {
                        SizeF bs = g.MeasureString(BadgeText, badgeFont);
                        var pill = new RectangleF(titlePos.X + ts.Width + 2f, titlePos.Y + 1f, bs.Width + 6f, bs.Height + 1f);
                        using (var pPath = DualRingIconControl.RoundedRect(pill, pill.Height / 2f))
                        using (var pBg = new SolidBrush(Color.FromArgb(36, accent.R, accent.G, accent.B)))
                        using (var pFg = new SolidBrush(accent))
                        {
                            g.FillPath(pBg, pPath);
                            g.DrawString(BadgeText, badgeFont, pFg, pill.X + 3f, pill.Y + 0.5f);
                        }
                    }
                }

                g.DrawString(SubtitleText ?? "", subFont, mutedBr, 38f, 32f);
            }
        }
    }

    internal sealed class PillButton : Control
    {
        public bool Primary { get; set; }
        public bool IsLight { get; set; }
        public bool DangerHover { get; set; }
        private bool _hovered;

        public PillButton()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true);
            Cursor = Cursors.Hand;
            BackColor = Color.Transparent;
        }

        protected override void OnMouseEnter(EventArgs e) { _hovered = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { _hovered = false; Invalidate(); base.OnMouseLeave(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

            Color accent = IsLight ? Color.FromArgb(26, 115, 232) : Color.FromArgb(138, 180, 248);
            Color accentHover = IsLight ? Color.FromArgb(21, 98, 200) : Color.FromArgb(160, 195, 250);
            Color primaryFg = IsLight ? Color.White : Color.FromArgb(18, 22, 30);
            Color secFg = DangerHover && _hovered
                ? Color.FromArgb(234, 67, 53)
                : (IsLight ? Color.FromArgb(95, 99, 104) : Color.FromArgb(170, 176, 184));
            Color secBorder = DangerHover && _hovered
                ? Color.FromArgb(234, 67, 53)
                : (IsLight ? Color.FromArgb(210, 214, 220) : Color.FromArgb(58, 63, 74));

            var rect = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
            using (var path = DualRingIconControl.RoundedRect(rect, (Height - 1.5f) / 2f))
            {
                if (Primary)
                {
                    Color fill = Enabled ? (_hovered ? accentHover : accent) : Color.FromArgb(120, accent.R, accent.G, accent.B);
                    using (var br = new SolidBrush(fill)) g.FillPath(br, path);
                }
                else
                {
                    using (var pen = new Pen(secBorder, 1f)) g.DrawPath(pen, path);
                }
            }

            using (var font = new Font("Microsoft YaHei UI", 9f, Primary ? FontStyle.Bold : FontStyle.Regular))
            using (var br = new SolidBrush(Primary ? primaryFg : secFg))
            using (var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
            {
                g.DrawString(Text ?? "", font, br, new RectangleF(0, 0, Width, Height), sf);
            }
        }
    }

    internal sealed class SetupForm : Form
    {
        private const string Version = "1.2.0";
        private readonly bool _isLight;
        private readonly ModeCard _managedCard;
        private readonly ModeCard _residentCard;
        private readonly Label _statusLbl;
        private readonly PillButton _installBtn;
        private readonly PillButton _uninstallBtn;

        private string _mode = "managed";
        private bool _installed;
        private bool _busy;

        private static string InstallDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AGYQuotaRings"); }
        }
        private static string DesktopShortcut
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Antigravity (Quota Rings).lnk"); }
        }
        private static string StartMenuShortcut
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Antigravity (Quota Rings).lnk"); }
        }
        private static string StartupShortcut
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "AGY Quota Rings.lnk"); }
        }

        public SetupForm()
        {
            _isLight = Theme.IsLight();
            Text = "AGY Quota Rings";
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(364, 286);
            BackColor = _isLight ? Color.FromArgb(248, 249, 250) : Color.FromArgb(20, 23, 30);
            ForeColor = _isLight ? Color.FromArgb(32, 33, 36) : Color.FromArgb(232, 234, 237);

            try
            {
                string icoPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app.ico");
                if (File.Exists(icoPath)) Icon = new Icon(icoPath);
            }
            catch { }

            DetectState();

            var badge = new DualRingIconControl { Location = new Point(20, 18), Size = new Size(38, 38) };
            Controls.Add(badge);

            var titleLbl = new Label
            {
                Text = "AGY Quota Rings",
                Font = new Font("Microsoft YaHei UI", 11f, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(66, 17),
                BackColor = Color.Transparent,
            };
            Controls.Add(titleLbl);

            var verLbl = new Label
            {
                Text = "v" + Version,
                Font = new Font("Microsoft YaHei UI", 8.5f, FontStyle.Regular),
                ForeColor = _isLight ? Color.FromArgb(95, 99, 104) : Color.FromArgb(154, 160, 166),
                AutoSize = true,
                Location = new Point(214, 21),
                BackColor = Color.Transparent,
            };
            Controls.Add(verLbl);

            var subLbl = new Label
            {
                Text = "Antigravity 左侧双环额度插件",
                Font = new Font("Microsoft YaHei UI", 8.5f, FontStyle.Regular),
                ForeColor = _isLight ? Color.FromArgb(95, 99, 104) : Color.FromArgb(154, 160, 166),
                AutoSize = true,
                Location = new Point(67, 40),
                BackColor = Color.Transparent,
            };
            Controls.Add(subLbl);

            _managedCard = new ModeCard
            {
                Location = new Point(20, 72),
                Size = new Size(324, 58),
                TitleText = "随 Antigravity 启动",
                SubtitleText = "关掉主程序即退出，不常驻后台",
                BadgeText = "推荐",
                IsLight = _isLight,
            };
            _managedCard.Click += (s, e) => { if (!_busy) { _mode = "managed"; RefreshUI(); } };
            Controls.Add(_managedCard);

            _residentCard = new ModeCard
            {
                Location = new Point(20, 140),
                Size = new Size(324, 58),
                TitleText = "后台常驻监听",
                SubtitleText = "开机自启，直接开原版即生效",
                IsLight = _isLight,
            };
            _residentCard.Click += (s, e) => { if (!_busy) { _mode = "resident"; RefreshUI(); } };
            Controls.Add(_residentCard);

            _statusLbl = new Label
            {
                Text = "",
                Font = new Font("Microsoft YaHei UI", 8.5f, FontStyle.Regular),
                ForeColor = Color.FromArgb(52, 168, 83),
                Location = new Point(22, 208),
                Size = new Size(320, 20),
                BackColor = Color.Transparent,
            };
            Controls.Add(_statusLbl);

            _installBtn = new PillButton
            {
                Primary = true,
                IsLight = _isLight,
                Location = new Point(20, 234),
                Size = new Size(324, 34),
                Text = "一键安装",
            };
            _installBtn.Click += async (s, e) => await HandleInstallAsync();
            Controls.Add(_installBtn);

            _uninstallBtn = new PillButton
            {
                Primary = false,
                DangerHover = true,
                IsLight = _isLight,
                Location = new Point(272, 234),
                Size = new Size(72, 34),
                Text = "卸载",
            };
            _uninstallBtn.Click += async (s, e) => await HandleUninstallAsync();
            Controls.Add(_uninstallBtn);

            RefreshUI();
        }

        private void DetectState()
        {
            string watcherExe = Path.Combine(InstallDir, "agy-quota-rings-watcher.exe");
            bool hasStartup = File.Exists(StartupShortcut);
            bool hasDesktop = File.Exists(DesktopShortcut) || File.Exists(StartMenuShortcut);
            _installed = File.Exists(watcherExe) && (hasStartup || hasDesktop);
            _mode = hasStartup ? "resident" : "managed";
        }

        private void RefreshUI()
        {
            _managedCard.Selected = (_mode == "managed");
            _residentCard.Selected = (_mode == "resident");
            _installBtn.Enabled = !_busy;
            _uninstallBtn.Enabled = !_busy;

            if (_installed)
            {
                _installBtn.Text = _busy ? "正在处理..." : "切换 / 更新";
                _installBtn.Size = new Size(242, 34);
                _uninstallBtn.Visible = true;
            }
            else
            {
                _installBtn.Text = _busy ? "正在安装..." : "一键安装";
                _installBtn.Size = new Size(324, 34);
                _uninstallBtn.Visible = false;
            }
            _installBtn.Invalidate();
            _uninstallBtn.Invalidate();
        }

        private static void StopExistingWatchers()
        {
            foreach (var p in Process.GetProcessesByName("agy-quota-rings-watcher"))
            {
                try { p.Kill(); p.WaitForExit(1500); } catch { }
            }
        }

        private static void CreateShortcut(string shortcutPath, string targetPath, string arguments, string workingDir, string iconLocation)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(shellType);
            object sc = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
            Type scType = sc.GetType();
            scType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { targetPath });
            scType.InvokeMember("Arguments", BindingFlags.SetProperty, null, sc, new object[] { arguments });
            scType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { workingDir });
            if (!string.IsNullOrEmpty(iconLocation))
            {
                scType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { iconLocation });
            }
            scType.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
        }

        private static string FindCscExe()
        {
            string winDir = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            string[] candidates =
            {
                Path.Combine(winDir, @"Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
                Path.Combine(winDir, @"Microsoft.NET\Framework\v4.0.30319\csc.exe"),
            };
            foreach (string c in candidates)
            {
                if (File.Exists(c)) return c;
            }
            return null;
        }

        private async Task HandleInstallAsync()
        {
            if (_busy) return;
            _busy = true;
            _statusLbl.ForeColor = _isLight ? Color.FromArgb(95, 99, 104) : Color.FromArgb(154, 160, 166);
            _statusLbl.Text = "正在安装配置...";
            RefreshUI();

            string mode = _mode;
            string error = null;

            await Task.Run(() =>
            {
                try
                {
                    StopExistingWatchers();
                    Directory.CreateDirectory(InstallDir);

                    string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                    string srcJs = Path.Combine(baseDir, "quota-rings.js");
                    string srcWatcherCs = Path.Combine(baseDir, "WatcherProgram.cs");
                    string srcIco = Path.Combine(baseDir, "app.ico");

                    string dstJs = Path.Combine(InstallDir, "quota-rings.js");
                    string dstIco = Path.Combine(InstallDir, "app.ico");
                    string dstWatcherExe = Path.Combine(InstallDir, "agy-quota-rings-watcher.exe");

                    File.Copy(srcJs, dstJs, true);
                    if (File.Exists(srcIco)) File.Copy(srcIco, dstIco, true);

                    string prebuiltWatcher = Path.Combine(baseDir, "agy-quota-rings-watcher.exe");
                    if (File.Exists(prebuiltWatcher))
                    {
                        File.Copy(prebuiltWatcher, dstWatcherExe, true);
                    }
                    else
                    {
                        string csc = FindCscExe();
                        if (string.IsNullOrEmpty(csc)) throw new Exception("未找到系统内置 .NET Framework 编译器");

                        var psi = new ProcessStartInfo
                        {
                            FileName = csc,
                            Arguments = string.Format(
                                "/nologo /utf8output /optimize+ /target:winexe {0} /out:\"{1}\" /r:System.dll /r:System.Core.dll /r:System.Net.Http.dll /r:System.Web.Extensions.dll \"{2}\"",
                                File.Exists(dstIco) ? "/win32icon:\"" + dstIco + "\"" : "",
                                dstWatcherExe,
                                srcWatcherCs
                            ),
                            UseShellExecute = false,
                            CreateNoWindow = true,
                            RedirectStandardOutput = true,
                            RedirectStandardError = true,
                        };
                        using (var p = Process.Start(psi))
                        {
                            string outStr = p.StandardOutput.ReadToEnd();
                            string errStr = p.StandardError.ReadToEnd();
                            p.WaitForExit();
                            if (p.ExitCode != 0) throw new Exception("编译监听程序失败: " + (errStr + outStr).Trim());
                        }
                    }

                    string iconLoc = File.Exists(dstIco) ? dstIco + ",0" : dstWatcherExe + ",0";

                    if (mode == "managed")
                    {
                        if (File.Exists(StartupShortcut)) File.Delete(StartupShortcut);
                        CreateShortcut(DesktopShortcut, dstWatcherExe, "--managed", InstallDir, iconLoc);
                        CreateShortcut(StartMenuShortcut, dstWatcherExe, "--managed", InstallDir, iconLoc);
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = dstWatcherExe,
                            Arguments = "--managed",
                            WorkingDirectory = InstallDir,
                            UseShellExecute = false,
                            CreateNoWindow = true,
                        });
                    }
                    else
                    {
                        if (File.Exists(DesktopShortcut)) File.Delete(DesktopShortcut);
                        if (File.Exists(StartMenuShortcut)) File.Delete(StartMenuShortcut);
                        CreateShortcut(StartupShortcut, dstWatcherExe, "--resident", InstallDir, iconLoc);
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = dstWatcherExe,
                            Arguments = "--resident",
                            WorkingDirectory = InstallDir,
                            UseShellExecute = false,
                            CreateNoWindow = true,
                        });
                    }
                }
                catch (Exception ex)
                {
                    error = ex.Message;
                }
            });

            _busy = false;
            if (error == null)
            {
                _installed = true;
                _statusLbl.ForeColor = Color.FromArgb(52, 168, 83);
                _statusLbl.Text = mode == "managed"
                    ? "✓ 已安装，桌面快捷方式已就绪"
                    : "✓ 已安装，后台常驻监听已启动";
            }
            else
            {
                _statusLbl.ForeColor = Color.FromArgb(234, 67, 53);
                _statusLbl.Text = "✕ " + error;
            }
            RefreshUI();
        }

        private async Task HandleUninstallAsync()
        {
            if (_busy) return;
            _busy = true;
            _statusLbl.ForeColor = _isLight ? Color.FromArgb(95, 99, 104) : Color.FromArgb(154, 160, 166);
            _statusLbl.Text = "正在卸载...";
            RefreshUI();

            await Task.Run(() =>
            {
                try
                {
                    string watcherExe = Path.Combine(InstallDir, "agy-quota-rings-watcher.exe");
                    if (File.Exists(watcherExe))
                    {
                        try
                        {
                            using (var p = Process.Start(new ProcessStartInfo
                            {
                                FileName = watcherExe,
                                Arguments = "--remove",
                                UseShellExecute = false,
                                CreateNoWindow = true,
                            }))
                            {
                                p.WaitForExit(4000);
                            }
                        }
                        catch { }
                    }
                    StopExistingWatchers();
                    if (File.Exists(DesktopShortcut)) File.Delete(DesktopShortcut);
                    if (File.Exists(StartMenuShortcut)) File.Delete(StartMenuShortcut);
                    if (File.Exists(StartupShortcut)) File.Delete(StartupShortcut);
                    if (Directory.Exists(InstallDir)) Directory.Delete(InstallDir, true);
                }
                catch { }
            });

            _busy = false;
            _installed = false;
            _statusLbl.ForeColor = _isLight ? Color.FromArgb(95, 99, 104) : Color.FromArgb(154, 160, 166);
            _statusLbl.Text = "✓ 已干净卸载";
            RefreshUI();
        }

        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
        }
    }
}
