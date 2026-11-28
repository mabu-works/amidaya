using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

// ==========================================
// 🎲 あみだや for Windows
// ==========================================
namespace Amidaya
{
    internal static class Program
    {
        [STAThread]
        // 🚀 アプリを起動する
        private static void Main()
        {
            ApplicationConfiguration.Initialize();
            Application.Run(new MainForm());
        }
    }

    internal sealed class MainForm : Form
    {
        // 🌐 Web版（amidaya）とそろえた定数・仕様
        private static readonly string[] ColorsHex =
        {
            "#e11d63", "#2563eb", "#059669", "#d97706", "#7c3aed", "#0891b2",
            "#db2777", "#65a30d", "#ea580c", "#4f46e5", "#0d9488", "#b91c1c"
        };
        private const int MinItems = 2;
        private const int MaxItems = 50;
        private const int MaxLabelLength = 20;
        private const int BaseCanvasWidth = 720;
        private const int CanvasHeight = 600;
        private const int PerColumnWidth = 56;
        private const int TraceTotalLimitMs = 10000;
        private const int TracePerPersonMs = 650;
        private const int TopPad = 54;
        private const int BottomPad = 54;

        // 🎨 画面色（Web版ダークテーマの値）
        private static readonly Color Bg = Color.FromArgb(10, 15, 28);
        private static readonly Color Surface = Color.FromArgb(17, 26, 44);
        private static readonly Color Surface2 = Color.FromArgb(24, 38, 66);
        private static readonly Color TextColor = Color.FromArgb(236, 241, 248);
        private static readonly Color Muted = Color.FromArgb(157, 177, 199);
        private static readonly Color Accent = Color.FromArgb(106, 141, 255);
        private static readonly Color LineColor = Color.FromArgb(38, 54, 80);

        private static readonly string[] DefaultParticipants = { "Aさん", "Bさん", "Cさん", "Dさん" };
        private static readonly string[] DefaultResults = { "大当たり", "当たり", "はずれ", "はずれ" };

        private readonly TextBox participantsBox;
        private readonly TextBox resultsBox;
        private readonly Button generateBtn;
        private readonly Button startBtn;
        private readonly Button copyBtn;
        private readonly Label statusLabel;
        private readonly ListBox resultList;
        private readonly LadderPanel ladderPanel;
        private readonly System.Windows.Forms.Timer animTimer;
        private readonly Stopwatch animWatch = new Stopwatch();
        private readonly Random random = new Random();

        private List<string> participants = new List<string>(DefaultParticipants);
        private List<string> results = new List<string>(DefaultResults);
        private List<HashSet<int>> rungs = new List<HashSet<int>>();
        private bool generated;
        private List<List<PointF>> tracedPaths = new List<List<PointF>>();
        private int[] outcomes = Array.Empty<int>();
        private int tracedCount;
        private bool animating;
        private int animIndex;
        private double animFrac;
        private string lastEdited = "p";
        private bool syncing;

        // 🪟 画面を組み立てる
        public MainForm()
        {
            Text = "あみだや for Windows｜あみだくじ";
            ClientSize = new Size(1120, 776);
            MinimumSize = new Size(1136, 815);
            BackColor = Bg;
            ForeColor = TextColor;
            Font = new Font("Yu Gothic UI", 10F);

            var title = new Label
            {
                Text = "あみだや｜あみだくじメーカー",
                Font = new Font("Yu Gothic UI", 15F, FontStyle.Bold),
                ForeColor = TextColor,
                Location = new Point(16, 12),
                AutoSize = true
            };
            Controls.Add(title);

            var pLabel = new Label
            {
                Text = "参加者（1行に1人）",
                ForeColor = Muted,
                Location = new Point(16, 56),
                AutoSize = true
            };
            Controls.Add(pLabel);

            participantsBox = MakeListBox(string.Join(Environment.NewLine, participants), 16, 82);
            participantsBox.TextChanged += (s, e) => { if (!syncing) { lastEdited = "p"; InvalidateLadder(); } };
            Controls.Add(participantsBox);

            var rLabel = new Label
            {
                Text = "結果・景品（1行に1件）",
                ForeColor = Muted,
                Location = new Point(16, 262),
                AutoSize = true
            };
            Controls.Add(rLabel);

            resultsBox = MakeListBox(string.Join(Environment.NewLine, results), 16, 288);
            resultsBox.TextChanged += (s, e) => { if (!syncing) { lastEdited = "r"; InvalidateLadder(); } };
            Controls.Add(resultsBox);

            generateBtn = new Button
            {
                Text = "あみだ生成",
                Font = new Font("Yu Gothic UI", 11F, FontStyle.Bold),
                BackColor = Accent,
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Location = new Point(16, 468),
                Size = new Size(142, 40)
            };
            generateBtn.FlatAppearance.BorderSize = 0;
            generateBtn.Click += (s, e) => Generate();
            Controls.Add(generateBtn);

            startBtn = new Button
            {
                Text = "スタート",
                BackColor = Surface2,
                ForeColor = TextColor,
                FlatStyle = FlatStyle.Flat,
                Location = new Point(166, 468),
                Size = new Size(142, 40),
                Enabled = false
            };
            startBtn.Click += (s, e) => StartTrace();
            Controls.Add(startBtn);

            copyBtn = new Button
            {
                Text = "結果をコピー",
                BackColor = Surface2,
                ForeColor = TextColor,
                FlatStyle = FlatStyle.Flat,
                Location = new Point(16, 516),
                Size = new Size(292, 36),
                Enabled = false
            };
            copyBtn.Click += (s, e) => CopyResults();
            Controls.Add(copyBtn);

            var resetBtn = new Button
            {
                Text = "リセット",
                BackColor = Surface2,
                ForeColor = TextColor,
                FlatStyle = FlatStyle.Flat,
                Location = new Point(16, 560),
                Size = new Size(292, 36)
            };
            resetBtn.Click += (s, e) =>
            {
                syncing = true;
                participantsBox.Text = string.Join("\r\n", DefaultParticipants);
                resultsBox.Text = string.Join("\r\n", DefaultResults);
                syncing = false;
                InvalidateLadder();
                statusLabel.Text = "リストをリセットしました。";
            };
            Controls.Add(resetBtn);

            statusLabel = new Label
            {
                Text = "「あみだ生成」を押してください。",
                ForeColor = Muted,
                Location = new Point(16, 608),
                Size = new Size(292, 140)
            };
            Controls.Add(statusLabel);

            var scrollPanel = new Panel
            {
                Location = new Point(332, 52),
                Size = new Size(772, 556),
                AutoScroll = true,
                BackColor = Surface,
                BorderStyle = BorderStyle.FixedSingle
            };
            ladderPanel = new LadderPanel(this)
            {
                Location = new Point(0, 0),
                Size = new Size(CanvasWidthFor(participants.Count), CanvasHeight),
                BackColor = Surface
            };
            scrollPanel.Controls.Add(ladderPanel);
            Controls.Add(scrollPanel);

            var resultLabel = new Label
            {
                Text = "結果",
                ForeColor = Muted,
                Location = new Point(332, 620),
                AutoSize = true
            };
            Controls.Add(resultLabel);

            resultList = new ListBox
            {
                Location = new Point(332, 646),
                Size = new Size(772, 110),
                BackColor = Surface,
                ForeColor = TextColor,
                BorderStyle = BorderStyle.FixedSingle
            };
            Controls.Add(resultList);

            animTimer = new System.Windows.Forms.Timer { Interval = 16 };
            animTimer.Tick += AnimTick;
        }

        // 📝 入力欄（複数行テキストボックス）を作る
        private TextBox MakeListBox(string text, int x, int y)
        {
            return new TextBox
            {
                Multiline = true,
                ScrollBars = ScrollBars.Vertical,
                Text = text,
                Location = new Point(x, y),
                Size = new Size(292, 168),
                BackColor = Surface,
                ForeColor = TextColor,
                Font = new Font("Yu Gothic UI", 10F),
                BorderStyle = BorderStyle.FixedSingle
            };
        }

        // 🖼️ キャンバス幅を列数から決める（Web版 canvasWidthFor と同じ）
        private static int CanvasWidthFor(int n) => Math.Max(BaseCanvasWidth, n * PerColumnWidth);

        // 📊 あみだの段数を参加者数から決める（8 + 3n。Web版 rowCount と同じ）
        private static int RowCount(int n) => 8 + 3 * n;

        // ⏱️ 1人あたりのトレース時間（合計10秒以内になるよう調整。Web版 traceDuration と同じ）
        private static int TraceDuration(int n) =>
            n < 1 ? TracePerPersonMs : Math.Min(TracePerPersonMs, TraceTotalLimitMs / n);

        // 📋 一覧テキストを解析する（Web版 parseBulkText と同じ：空行無視・20文字切り詰め・上限50）
        private static List<string> ParseList(string text)
        {
            var list = new List<string>();
            foreach (var line in text.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None))
            {
                var s = line.Trim();
                if (s.Length > MaxLabelLength) s = s.Substring(0, MaxLabelLength);
                if (s.Length == 0) continue;
                list.Add(s);
                if (list.Count >= MaxItems) break;
            }
            return list;
        }

        // ⚖️ 参加者と結果の数をそろえる（最後に編集した側の件数に合わせる。Web版 syncCounts と同じ方針）
        private void SyncCounts()
        {
            var changed = lastEdited == "p" ? participants : results;
            var other = lastEdited == "p" ? results : participants;
            string label = lastEdited == "p" ? "結果" : "参加者";
            int n = changed.Count;
            while (other.Count > n) other.RemoveAt(other.Count - 1);
            while (other.Count < n) other.Add(label + (other.Count + 1));
        }

        // 🔄 生成済み状態を無効化する
        private void InvalidateLadder()
        {
            if (animating) { animTimer.Stop(); animating = false; }
            generated = false;
            tracedPaths = new List<List<PointF>>();
            outcomes = Array.Empty<int>();
            tracedCount = 0;
            startBtn.Enabled = false;
            copyBtn.Enabled = false;
            resultList.Items.Clear();
            int n = Math.Max(ParseList(participantsBox.Text).Count, ParseList(resultsBox.Text).Count);
            ladderPanel.Size = new Size(CanvasWidthFor(Math.Max(2, n)), CanvasHeight);
            ladderPanel.Invalidate();
        }

// ==========================================
// 🎲 あみだ生成（Web版 generateLadder と同じアルゴリズム）
// ==========================================
        private void Generate()
        {
            participants = ParseList(participantsBox.Text);
            results = ParseList(resultsBox.Text);
            if (participants.Count < MinItems || results.Count < MinItems)
            {
                statusLabel.Text = "参加者と結果はそれぞれ2件以上入れてください。";
                return;
            }
            SyncCounts();
            syncing = true;
            participantsBox.Text = string.Join(Environment.NewLine, participants);
            resultsBox.Text = string.Join(Environment.NewLine, results);
            syncing = false;

            int n = participants.Count;
            int rows = RowCount(n);
            rungs = new List<HashSet<int>>();
            for (int r = 0; r < rows; r++)
            {
                var rowSet = new HashSet<int>();
                int c = 0;
                while (c < n - 1)
                {
                    if (random.NextDouble() < 0.45)
                    {
                        rowSet.Add(c);
                        c += 2; // 横線の右隣には置かない（重なり防止）
                    }
                    else
                    {
                        c += 1;
                    }
                }
                rungs.Add(rowSet);
            }
            generated = true;
            tracedPaths = new List<List<PointF>>();
            tracedCount = 0;
            outcomes = ComputeOutcomes();
            resultList.Items.Clear();
            copyBtn.Enabled = false;
            startBtn.Enabled = true;
            ladderPanel.Size = new Size(CanvasWidthFor(n), CanvasHeight);
            ladderPanel.Invalidate();
            statusLabel.Text = "あみだを生成しました。「スタート」で結果を見ましょう。";
        }

        // 🎲 各参加者の到達結果を計算する
        private int[] ComputeOutcomes()
        {
            int n = participants.Count;
            var outArr = new int[n];
            for (int start = 0; start < n; start++)
            {
                int col = start;
                for (int r = 0; r < rungs.Count; r++)
                {
                    if (rungs[r].Contains(col)) col += 1;
                    else if (rungs[r].Contains(col - 1)) col -= 1;
                }
                outArr[start] = col;
            }
            return outArr;
        }

        // 📐 列の x 座標と段の y 座標を計算する
        private (float[] xs, Func<int, float> rowY) Geometry(int n)
        {
            float w = ladderPanel.Width;
            float margin = Math.Max(40f, w / (n + 1) / 1.4f);
            float step = n > 1 ? (w - margin * 2) / (n - 1) : 0;
            var xs = new float[n];
            for (int i = 0; i < n; i++) xs[i] = n > 1 ? margin + step * i : w / 2f;
            int rows = rungs.Count > 0 ? rungs.Count : RowCount(n);
            Func<int, float> rowY = r => TopPad + (CanvasHeight - TopPad - BottomPad) / (float)rows * (r + 0.5f);
            return (xs, rowY);
        }

        // 🗺️ 参加者 start の経路を座標列で返す
        private List<PointF> PathPoints(int start)
        {
            int n = participants.Count;
            var (xs, rowY) = Geometry(n);
            var pts = new List<PointF> { new PointF(xs[start], TopPad) };
            int col = start;
            for (int r = 0; r < rungs.Count; r++)
            {
                float yMid = rowY(r);
                pts.Add(new PointF(xs[col], yMid));
                if (rungs[r].Contains(col))
                {
                    col += 1;
                    pts.Add(new PointF(xs[col], yMid));
                }
                else if (rungs[r].Contains(col - 1))
                {
                    col -= 1;
                    pts.Add(new PointF(xs[col], yMid));
                }
            }
            pts.Add(new PointF(xs[col], CanvasHeight - BottomPad));
            return pts;
        }

// ==========================================
// ▶️ スタート（1人ずつトレース・Web版 startTrace と同じ）
// ==========================================
        private void StartTrace()
        {
            if (!generated || animating) return;
            animating = true;
            startBtn.Enabled = false;
            generateBtn.Enabled = false;
            copyBtn.Enabled = false;
            resultList.Items.Clear();
            tracedPaths = new List<List<PointF>>();
            for (int i = 0; i < participants.Count; i++) tracedPaths.Add(PathPoints(i));
            tracedCount = 0;
            animIndex = 0;
            animFrac = 0;
            animWatch.Restart();
            animTimer.Start();
            ladderPanel.Invalidate();
        }

        // ⏱️ アニメーションを1コマ進める
        private void AnimTick(object? sender, EventArgs e)
        {
            int duration = TraceDuration(participants.Count);
            double frac = duration <= 0 ? 1 : Math.Min(1.0, animWatch.ElapsedMilliseconds / (double)duration);
            animFrac = frac;
            ladderPanel.Invalidate();
            if (frac >= 1.0)
            {
                tracedCount = animIndex + 1;
                animIndex += 1;
                animFrac = 0;
                if (animIndex >= tracedPaths.Count)
                {
                    animTimer.Stop();
                    animWatch.Stop();
                    animating = false;
                    generateBtn.Enabled = true;
                    startBtn.Enabled = true;
                    copyBtn.Enabled = true;
                    ShowResults();
                    statusLabel.Text = "結果が出ました！";
                    ladderPanel.Invalidate();
                }
                else
                {
                    animWatch.Restart();
                }
            }
        }

        // 📋 結果一覧を表示する
        private void ShowResults()
        {
            resultList.Items.Clear();
            for (int i = 0; i < participants.Count; i++)
            {
                string who = participants[i].Length > 0 ? participants[i] : "参加者" + (i + 1);
                string res = outcomes[i] < results.Count && results[outcomes[i]].Length > 0
                    ? results[outcomes[i]] : "結果" + (outcomes[i] + 1);
                resultList.Items.Add(who + " → " + res);
            }
        }

        // 📋 結果をクリップボードにコピーする
        private void CopyResults()
        {
            if (outcomes.Length == 0) return;
            var lines = new List<string>();
            for (int i = 0; i < participants.Count; i++)
            {
                lines.Add(participants[i] + " → " + results[outcomes[i]]);
            }
            Clipboard.SetText(string.Join(Environment.NewLine, lines));
            statusLabel.Text = "結果をコピーしました。";
        }

// ==========================================
// 🎨 描画（Web版 drawLadder と同じ幾何）
// ==========================================
        internal void DrawLadder(Graphics g)
        {
            int n = participants.Count;
            if (n == 0) return;
            var (xs, rowY) = Geometry(n);
            float w = ladderPanel.Width;
            float topY = TopPad;
            float bottomY = CanvasHeight - BottomPad;

            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;

            float colStep = n > 1 ? Math.Abs(xs[1] - xs[0]) : w;
            int topFont = Math.Max(10, Math.Min(17, (int)(colStep * 0.32)));
            int bottomFont = Math.Max(10, Math.Min(16, (int)(colStep * 0.30)));
            float mw = n > 1 ? colStep - 6 : w;

            // 🏷️ ラベルを描く
            var format = new StringFormat
            {
                Alignment = StringAlignment.Center,
                LineAlignment = StringAlignment.Center,
                Trimming = StringTrimming.None
            };
            for (int i = 0; i < n; i++)
            {
                var color = ColorTranslator.FromHtml(ColorsHex[i % ColorsHex.Length]);
                using (var font = new Font("Yu Gothic UI", topFont, FontStyle.Bold))
                using (var brush = new SolidBrush(color))
                {
                    string label = FitLabel(participants[i].Length > 0 ? participants[i] : "参加者" + (i + 1), mw, topFont);
                    g.DrawString(label, font, brush, new RectangleF(xs[i] - mw / 2, 26 - topFont, mw, topFont * 2), format);
                }
                if (generated)
                {
                    using var font = new Font("Yu Gothic UI", bottomFont, FontStyle.Bold);
                    string label = FitLabel(results[i].Length > 0 ? results[i] : "結果" + (i + 1), mw, bottomFont);
                    g.DrawString(label, font, Brushes.White, new RectangleF(xs[i] - mw / 2, CanvasHeight - 24 - bottomFont, mw, bottomFont * 2), format);
                }
            }

            // ➖ 未生成時は縦線だけ描く
            if (!generated)
            {
                using var pen = new Pen(LineColor, 2);
                for (int i = 0; i < n; i++)
                {
                    g.DrawLine(pen, xs[i], topY, xs[i], bottomY);
                }
                return;
            }

            using (var pen = new Pen(LineColor, 3))
            {
                // ➖ 縦線を描く
                for (int i = 0; i < n; i++)
                {
                    g.DrawLine(pen, xs[i], topY, xs[i], bottomY);
                }
                // ➖ 横線を描く
                for (int r = 0; r < rungs.Count; r++)
                {
                    float y = rowY(r);
                    foreach (var c in rungs[r])
                    {
                        g.DrawLine(pen, xs[c], y, xs[c + 1], y);
                    }
                }
            }

            // 🖍️ トレース済み経路を描く
            for (int i = 0; i < tracedCount && i < tracedPaths.Count; i++)
            {
                DrawPath(g, tracedPaths[i], ColorTranslator.FromHtml(ColorsHex[i % ColorsHex.Length]), 1.0);
            }
            // ▶️ アニメーション中の経路を描く
            if (animating && animIndex < tracedPaths.Count)
            {
                DrawPath(g, tracedPaths[animIndex],
                    ColorTranslator.FromHtml(ColorsHex[animIndex % ColorsHex.Length]), animFrac);
            }
        }

        // 🖍️ 経路を描く（frac の割合だけ部分描画する）
        private static void DrawPath(Graphics g, List<PointF> pts, Color color, double frac)
        {
            if (pts.Count < 2) return;
            double total = 0;
            var segs = new double[pts.Count - 1];
            for (int i = 1; i < pts.Count; i++)
            {
                double len = Math.Sqrt(Math.Pow(pts[i].X - pts[i - 1].X, 2) + Math.Pow(pts[i].Y - pts[i - 1].Y, 2));
                segs[i - 1] = len;
                total += len;
            }
            double remain = total * frac;
            var drawPts = new List<PointF> { pts[0] };
            for (int i = 1; i < pts.Count; i++)
            {
                if (remain >= segs[i - 1])
                {
                    drawPts.Add(pts[i]);
                    remain -= segs[i - 1];
                }
                else
                {
                    double t = segs[i - 1] == 0 ? 0 : remain / segs[i - 1];
                    drawPts.Add(new PointF(
                        (float)(pts[i - 1].X + (pts[i].X - pts[i - 1].X) * t),
                        (float)(pts[i - 1].Y + (pts[i].Y - pts[i - 1].Y) * t)));
                    break;
                }
            }
            if (drawPts.Count < 2) return;
            using var pen = new Pen(color, 5) { LineJoin = LineJoin.Round, StartCap = LineCap.Round, EndCap = LineCap.Round };
            g.DrawLines(pen, drawPts.ToArray());
        }

        // 🏷️ ラベルを指定幅に収まるよう省略する（Web版 fitLabel と同じ概算）
        private static string FitLabel(string text, float maxWidth, int fontSize)
        {
            if (maxWidth <= 0) return text;
            int maxChars = Math.Max(2, (int)(maxWidth / Math.Max(1, fontSize)));
            if (text.Length <= maxChars) return text;
            return text.Substring(0, Math.Max(1, maxChars - 1)) + "…";
        }
    }

    internal sealed class LadderPanel : Panel
    {
        private readonly MainForm form;

        // 🎨 描画パネルを作る
        public LadderPanel(MainForm form)
        {
            this.form = form;
            DoubleBuffered = true;
        }

        // 🎨 描画を MainForm に委譲する
        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            form.DrawLadder(e.Graphics);
        }
    }
}
