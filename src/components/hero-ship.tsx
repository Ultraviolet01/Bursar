// Landing hero scene. Loops two states on 8s (see globals.css):
//  A: a small payment, the ship rides high and "Your line" stays above water.
//  B: a large payment, the ship sits low and the line goes under, so it waits for you.

const PALETTE = ["#0E5E56", "#C38A26", "#4F6670", "#DCE7EA", "#A9C6CF", "#155E6C", "#0E5E56", "#DCE7EA", "#C38A26", "#4F6670"];

function Container({ x, y, color }: { x: number; y: number; color: string }) {
  const pale = color === "#DCE7EA" || color === "#A9C6CF";
  return (
    <g>
      <rect x={x} y={y} width={46} height={23} fill={color} stroke="#F3F6F5" strokeWidth={1.5} />
      {pale && [10, 18, 26, 34].map((dx) => <line key={dx} x1={x + dx} x2={x + dx} y1={y + 5} y2={y + 18} stroke="#8EA9B1" strokeWidth={1} />)}
      {color === "#C38A26" && [8, 14, 20, 26, 32, 38].map((dx) => <line key={dx} x1={x + dx} x2={x + dx} y1={y + 4} y2={y + 19} stroke="#A9741C" strokeWidth={1} />)}
    </g>
  );
}

// Deck slopes from y=252 at x=400 to y=236 at x=1150.
const HEIGHTS = [2, 3, 4, 4, 3, 3, 2, 3, 4, 4, 5, 4, 3, 3, 2, 2];
const colX = (c: number) => 410 + c * 46;
const deckY = (x: number) => 252 - ((x - 400) / 750) * 16;

function Stacks() {
  const out: React.ReactNode[] = [];
  HEIGHTS.forEach((h, c) => {
    for (let r = 0; r < h; r++) out.push(<Container key={`${c}-${r}`} x={colX(c)} y={deckY(colX(c)) - 23 * (r + 1)} color={PALETTE[(c * 3 + r * 7) % PALETTE.length]} />);
  });
  return <g>{out}</g>;
}

/** The heavy load in state B: one more tier on the low columns. */
function ExtraLoad() {
  const cols = [0, 5, 6, 7, 14, 15];
  return (
    <g className="hero-extra">
      {cols.map((c, i) => (
        <Container key={c} x={colX(c)} y={deckY(colX(c)) - 23 * (HEIGHTS[c] + 1)} color={["#C38A26", "#0E5E56", "#4F6670", "#C38A26", "#155E6C", "#DCE7EA"][i]} />
      ))}
    </g>
  );
}

function Waves({ y, opacity, className }: { y: number; opacity: number; className: string }) {
  const arcs = [];
  for (let x = -120; x < 1600; x += 60) arcs.push(<path key={x} d={`M${x},${y} q15,-6 30,0`} stroke="#FFFFFF" strokeWidth={2} fill="none" />);
  return <g className={className} opacity={opacity}>{arcs}</g>;
}

export function HeroShip() {
  return (
    <div className="relative overflow-hidden">
      {/* Captions */}
      <div className="pointer-events-none relative z-10 mx-4 mt-2 h-[64px] sm:absolute sm:left-[6%] sm:top-10 sm:m-0 sm:h-auto">
        <div className="hero-capA absolute left-0 top-0 w-[320px] sm:w-[520px]">
          <div className="display text-[22px] text-ink sm:text-[30px]">Paying Ada Obi, NGN 450,000</div>
          <div className="mt-1 text-[14px] text-teal sm:text-[16px]">Under the line, so Bursar pays it alone</div>
        </div>
        <div className="hero-capB absolute left-0 top-0 w-[320px] sm:w-[520px]">
          <div className="display text-[22px] text-ink sm:text-[30px]">New vendor, NGN 2,500,000</div>
          <div className="mt-1 text-[14px] text-amber sm:text-[16px]">Over the line, so it waits for your approval</div>
        </div>
      </div>

      <svg viewBox="0 0 1440 480" className="block h-auto w-full" role="img" aria-label="A cargo ship with a painted line on its hull. A small payment keeps the line above water. A large payment pushes it under.">
        {/* chart-paper grid */}
        <g stroke="#E4EAE9" strokeWidth={1}>
          {Array.from({ length: 17 }, (_, i) => <line key={`v${i}`} x1={i * 90} x2={i * 90} y1={0} y2={372} />)}
          {Array.from({ length: 4 }, (_, i) => <line key={`h${i}`} x1={0} x2={1440} y1={i * 90 + 60} y2={i * 90 + 60} />)}
        </g>

        {/* compass */}
        <g transform="translate(1290 110)">
          <text x={0} y={-62} textAnchor="middle" className="display" fontSize={16} fill="#0F2D3A">N</text>
          <circle r={46} fill="#F3F6F5" stroke="#9AA9AD" strokeWidth={1.5} />
          <circle r={38} fill="none" stroke="#C8D2D4" strokeWidth={1} />
          {Array.from({ length: 24 }, (_, i) => {
            const a = (i * Math.PI) / 12;
            const r1 = i % 6 === 0 ? 30 : 35;
            return <line key={i} x1={Math.sin(a) * r1} y1={-Math.cos(a) * r1} x2={Math.sin(a) * 38} y2={-Math.cos(a) * 38} stroke="#9AA9AD" strokeWidth={1} />;
          })}
          <line x1={-46} x2={46} y1={0} y2={0} stroke="#C8D2D4" />
          <line y1={-46} y2={46} x1={0} x2={0} stroke="#C8D2D4" />
          <g className="hero-needle">
            <path d="M0,-36 L6,0 L0,4 L-6,0 Z" fill="#C38A26" />
            <path d="M0,36 L6,0 L0,-4 L-6,0 Z" fill="#9FB8BF" />
          </g>
          <circle r={3} fill="#F3F6F5" stroke="#0F2D3A" />
        </g>

        {/* ship */}
        <g className="hero-ship">
          <g className="hero-bob">
            {/* superstructure */}
            <rect x={300} y={172} width={92} height={82} fill="#DDE5E6" />
            <rect x={292} y={164} width={108} height={10} fill="#C9D4D6" />
            {[0, 1, 2, 3].map((r) =>
              [0, 1, 2, 3, 4, 5].map((c) => <rect key={`${r}${c}`} x={312 + c * 12} y={184 + r * 16} width={7} height={r === 0 ? 7 : 5} fill={r === 0 ? "#102C38" : "#4F6670"} />),
            )}
            <rect x={334} y={128} width={24} height={36} fill="#0E5E56" />
            <rect x={334} y={138} width={24} height={6} fill="#C38A26" />
            <line x1={384} x2={384} y1={116} y2={164} stroke="#102C38" strokeWidth={2.5} />
            <line x1={376} x2={392} y1={128} y2={128} stroke="#102C38" strokeWidth={2} />
            <circle cx={384} cy={114} r={3.5} fill="#C38A26" />

            <Stacks />
            <ExtraLoad />

            {/* hull */}
            <path d="M262,262 L1182,236 L1140,382 L280,388 Z" fill="#102C38" />
            <path d="M262,262 L1182,236 L1180,242 L263,268 Z" fill="#1E4A5C" />
            <path d="M290,330 L1150,316" stroke="#1E4A5C" strokeWidth={1.5} />
            <text x={1095} y={292} textAnchor="end" className="display" fontSize={22} letterSpacing={4} fill="#FFFFFF">BURSAR</text>
            <circle cx={1106} cy={286} r={4} fill="none" stroke="#5E8E9A" strokeWidth={1.5} />

            {/* load line */}
            <rect x={272} y={352} width={876} height={8} fill="#0E5E56" />
            <g transform="translate(740 339)">
              <line x1={-26} x2={26} y1={0} y2={0} stroke="#C38A26" strokeWidth={2.5} />
              <circle r={12} fill="none" stroke="#C38A26" strokeWidth={2.5} />
              <text x={40} y={5} className="display" fontSize={16} fill="#FFFFFF">Your line</text>
              <text x={124} y={5} fontSize={12} fill="#AFC4CA">NGN 2,000,000 per payment</text>
            </g>
          </g>
        </g>

        {/* sea, drawn over the hull so the sunk part reads as underwater */}
        <rect x={0} y={372} width={1440} height={108} fill="#C7DADF" opacity={0.9} />
        <rect x={0} y={404} width={1440} height={76} fill="#AFCBD3" opacity={0.96} />
        <ellipse cx={720} cy={430} rx={430} ry={12} fill="#102C38" opacity={0.08} />
        <line x1={0} x2={1440} y1={372} y2={372} stroke="#8FB0B9" strokeWidth={1.5} />
        <Waves y={404} opacity={0.9} className="hero-waves" />
        <Waves y={440} opacity={0.5} className="hero-waves-slow" />
        <Waves y={468} opacity={0.4} className="hero-waves" />
      </svg>
    </div>
  );
}
