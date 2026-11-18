export const enc = (s: string) => new TextEncoder().encode(s);

/** Fansub-style ASS covering layers, signs, karaoke, fx, drawings and comments. */
export const FANSUB_ASS = `[Script Info]
Title: test
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,10,1
Style: Thoughts,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,-1,0,0,100,100,0,0,1,2,1,2,10,10,10,1
Style: Sign-Board,Arial,30,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,10,1
Style: OP-Romaji,Arial,30,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,8,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Comment: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,template,{\\k10}not shown
Dialogue: 0,0:00:01.00,0:00:03.00,Default,Taro,0,0,0,,Hello, world!\\NSecond {\\i1}line{\\i0} here
Dialogue: 1,0:00:01.00,0:00:03.00,Default,Taro,0,0,0,,Hello, world!\\NSecond {\\i1}line{\\i0} here
Dialogue: 0,0:00:04.00,0:00:05.00,Thoughts,,0,0,0,,I wonder{\\i0}... no{\\iclip(0,0,10,10)}
Dialogue: 0,0:00:06.00,0:00:06.04,Sign-Board,,0,0,0,,{\\pos(100,200)}CLOSED
Dialogue: 0,0:00:06.04,0:00:06.08,Sign-Board,,0,0,0,,{\\pos(101,200)}CLOSED
Dialogue: 0,0:00:06.08,0:00:06.12,Default,,0,0,0,,{\\an8\\pos(101,200)\\fs20}CLOSED
Dialogue: 0,0:00:07.00,0:00:08.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100 0 100{\\p0}
Dialogue: 0,0:00:09.00,0:00:12.00,OP-Romaji,,0,0,0,,{\\k20}ko{\\k30}ko{\\k25}ro
Dialogue: 0,0:00:09.00,0:00:09.20,OP-Romaji,,0,0,0,fx,{\\pos(10,10)}ko
Dialogue: 0,0:00:13.00,0:00:14.00,Default,,0,0,0,,{\\an8}Overlapping speaker\\hnbsp
`;
