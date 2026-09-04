// A corpus of terminal streams shared by the chunk-boundary and the golden
// tests. Every entry is something a shell or a full-screen program actually
// emits, plus the awkward tails -- truncated sequences, a lone surrogate --
// that a byte stream can end a chunk on.
import { CSI, ESC } from './helpers';

const BEL = '\x07';
const ST = `${ESC}\\`;

export const STREAM_CORPUS: readonly (readonly [string, string])[] = [
  ['plain lines', 'alpha\nbeta\ngamma\n'],
  ['crlf lines', 'one\r\ntwo\r\nthree\r\n'],
  ['carriage return overwrite', 'progress 10%\rprogress 20%\rprogress 100%\n'],
  ['backspace and tab', `abc\b\bX\tY\n`],
  ['sgr 16 colours', `${CSI}31mred ${CSI}1;32mbold green${CSI}0m plain\n`],
  [
    'sgr 256 and truecolor',
    `${CSI}38;5;196mA${CSI}48;2;12;34;56mB${CSI}38:2::21:42:63mC${CSI}0m\n`,
  ],
  [
    'sgr attributes',
    `${CSI}3mitalic ${CSI}4munder ${CSI}9mstrike ${CSI}7minverse ${CSI}2mdim ${CSI}8mhidden${CSI}0m\n`,
  ],
  ['cursor positioning', `${CSI}2;3HX${CSI}1;1HY${CSI}3B${CSI}2CZ${CSI}A${CSI}DW`],
  ['cursor column and row', `line\n${CSI}5Gcol5${CSI}2dtop${CSI}Hhome`],
  ['erase display', `one\ntwo\nthree\n${CSI}2;1H${CSI}J`],
  ['erase display above', `one\ntwo\nthree${CSI}2;2H${CSI}1J`],
  ['erase line variants', `abcdef${CSI}3G${CSI}K\nabcdef${CSI}3G${CSI}1K\nabcdef${CSI}2K\n`],
  [
    'erase and delete cells',
    `abcdef${CSI}2G${CSI}2X\nabcdef${CSI}2G${CSI}2P\nabcdef${CSI}2G${CSI}2@\n`,
  ],
  ['insert and delete lines', `a\nb\nc\nd${CSI}2;1H${CSI}L${CSI}4;1H${CSI}M`],
  ['scroll region', `L0\nL1\nL2\nL3\nL4${CSI}2;4r${CSI}4;1HX\nY\n${CSI}r`],
  ['scroll up and down', `a\nb\nc\nd${CSI}H${CSI}2S${CSI}T`],
  ['clear screen and home', `before\n${CSI}2J${CSI}Hafter\n`],
  ['clear scrollback', `${'row\n'.repeat(12)}${CSI}3J${CSI}Hfresh`],
  ['alternate screen', `main text\n${CSI}?1049h${CSI}Halt screen\n${CSI}?1049lback on main\n`],
  ['alternate screen 47', `main\n${CSI}?47halt${CSI}?47l`],
  ['save and restore cursor', `abc${ESC}7\nsecond${ESC}8X${CSI}s\n${CSI}uY`],
  ['index and reverse index', `a${ESC}Db${ESC}Ec${ESC}Md`],
  ['ris mid stream', `old\nlines\n${ESC}cnew\n`],
  ['osc title bel', `${ESC}]0;my title${BEL}text\n`],
  ['osc title st', `${ESC}]2;other title${ST}text\n`],
  ['osc 8 link', `${ESC}]8;;https://example.com/a${ST}link${ESC}]8;;${ST} plain\n`],
  ['osc 8 file link', `${ESC}]8;;./x.md${ST}local${ESC}]8;;${ST}\n`],
  ['dcs pm apc strings', `${ESC}Pq#0;2;0;0;0${ST}a${ESC}^privacy${ST}b${ESC}_app${ST}c\n`],
  ['charset designations', `${ESC}(B${ESC})0${ESC}*Avisible${ESC}#8\n`],
  [
    'modes',
    `${CSI}?25lhidden${CSI}?25h${CSI}?7lnowrap${CSI}?7h${CSI}4hins${CSI}4l${CSI}?1h${CSI}?2004hend\n`,
  ],
  ['cjk and emoji', `path ${CSI}36m你好世界${CSI}0m ok\n纯中文的一行，带标点。\n👨‍💻 🇨🇳 ℹ️ café\n`],
  ['wide glyph at the line end', `${'x'.repeat(19)}界tail\n`],
  ['combining marks', `é ä ñ\n`],
  ['long line wraps', `${'0123456789'.repeat(9)}\nnext\n`],
  ['more rows than the grid', Array.from({ length: 40 }, (_, index) => `row ${index}`).join('\n')],
  ['unterminated csi at end', `keep${CSI}32`],
  ['lone esc at end', `keep${ESC}`],
  ['esc bracket at end', `keep${ESC}[`],
  ['charset escape at end', `keep${ESC}(`],
  ['unterminated osc title at end', `keep${ESC}]0;half a title`],
  ['unterminated osc link at end', `first\nsecond\nthird${ESC}]8;;./x.md`],
  ['unterminated dcs at end', `keep${ESC}Ppayload`],
  ['lone high surrogate at end', 'keep\ud83d'],
  ['lone low surrogate', 'keep\ude00x\n'],
  ['surrogate pair then text', 'keep😀x\n'],
  ['controls inside text', 'a\x00b\x01c\x7fd\n'],
  ['bare cr at end', 'line\r'],
  ['crlf split point', 'line\r\nnext\r'],
  ['empty', ''],
  [
    // zsh's line editor redrawing a two-line prompt, byte for byte off a real
    // PTY: the prompt is reprinted from the top on every window change, and it
    // gets back to the top with CR, CR, CUU, then erases what was there with
    // ED. Nothing else in this corpus moves the cursor *up* and then writes
    // over what it passed, and the whole of the multi-line-prompt regression
    // lived in whether that lands on the old prompt or below it.
    'multi-line prompt redraw',
    `\r\n${CSI}36mosuki${CSI}39m ${CSI}35mmain${CSI}39m \u276f ${CSI}K` +
      ['n', 'nv', 'nvi', 'nvim']
        .map(
          (buffer) =>
            `\r\r${CSI}A${CSI}0m${CSI}27m${CSI}24m${CSI}J\r` +
            `\n${CSI}36mosuki${CSI}39m ${CSI}35mmain${CSI}39m \u276f ${buffer}`
        )
        .join(''),
  ],
  [
    // The same idiom in the form a single-line prompt uses it: erase the line,
    // step up, erase again, reprint. Kept separate because it never leaves the
    // top row and so exercises the CUU clamp rather than the fold.
    'line editor redraw at the top row',
    `${CSI}1;1Hfirst\r${CSI}K${CSI}1Asecond\r${CSI}2Kthird`,
  ],
  [
    'shell session',
    `${CSI}1;32muser@host${CSI}0m:${CSI}1;34m~${CSI}0m$ ls\r\nREADME.md  src/\r\n${CSI}1;32muser@host${CSI}0m:${CSI}1;34m~${CSI}0m$ ${CSI}?2004h`,
  ],
  [
    'full screen program',
    `${CSI}?1049h${CSI}?1h${CSI}2J${CSI}H${CSI}7m status line ${CSI}0m${CSI}2;1H${'~\n'.repeat(5)}${CSI}10;1H${CSI}K-- INSERT --${CSI}2;1H`,
  ],
];
