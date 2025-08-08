// const colors = [6, 2, 3, 4, 5, 1];
const colors = [
	'#0000CC','#0000FF','#0033CC','#0033FF','#0066CC','#0066FF','#0099CC','#0099FF',
	'#00CC00','#00CC33','#00CC66','#00CC99','#00CCCC','#00CCFF','#3300CC','#3300FF',
	'#3333CC','#3333FF','#3366CC','#3366FF','#3399CC','#3399FF','#33CC00','#33CC33',
	'#33CC66','#33CC99','#33CCCC','#33CCFF','#6600CC','#6600FF','#6633CC','#6633FF',
	'#66CC00','#66CC33','#9900CC','#9900FF','#9933CC','#9933FF','#99CC00','#99CC33',
	'#CC0000','#CC0033','#CC0066','#CC0099','#CC00CC','#CC00FF','#CC3300','#CC3333',
	'#CC3366','#CC3399','#CC33CC','#CC33FF','#CC6600','#CC6633','#CC9900','#CC9933',
	'#CCCC00','#CCCC33','#FF0000','#FF0033','#FF0066','#FF0099','#FF00CC','#FF00FF',
	'#FF3300','#FF3333','#FF3366','#FF3399','#FF33CC','#FF33FF','#FF6600','#FF6633',
	'#FF9900','#FF9933','#FFCC00','#FFCC33'
];

function selectColor(namespace) {
  let hash = 0;
  for (let i = 0; i < namespace.length; i++) {
    hash = ((hash << 5) - hash) + namespace.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return colors[Math.abs(hash) % colors.length];
}

function consoleFmt(ts, ns, color, msg) {
  // console.log(`%c${curr}${ns} %s`, `color: #${debug.color.toString(16).padStart(6, '0')}`, msg);
  return [`%c${ts}${ns?` ${ns}`:''} \x1B[1;94m${msg}\x1B[m`, `color: ${color}`];
}

function debugFactory(namespace, color, fmt, sink) {
  let prevTime;
  function debug(...args) {
    if (!debugFactory.enabled || !debug.enabled) return;
    const curr = Number(new Date());
    const ms = curr - (prevTime || curr);
    // @ts-ignore
    debug.diff = ms, debug.prev = prevTime, debug.curr = curr, prevTime = curr;
    const msg = args.reduce((acc, arg) => {
      if (typeof arg === "string") return acc + (acc.length > 0 ? " " : "") + arg;
      return acc + (acc.length > 0 ? ' ' : '') + JSON.stringify(arg);
    }, '');
    // @ts-ignore
    const ts = (debug.prev && ms < 1000 ? `+${ms}` : `${curr}`).padStart(13, '\u00A0');
    debug.sink(...debug.fmt(ts, namespace, debug.color, msg));
  }
  debug.useColors = true;
  debug.color = color ?? selectColor(namespace);
  debug.sink = sink ?? defaultSink;
  debug.fmt = fmt ?? consoleFmt;
  debug.reset = () => {
    prevTime = 0;
    return debug;
  };
  debug.namespace = namespace;
  debugFactory.nss.set(namespace, debug);
  debug.enabled = true;
  return debug;
}

debugFactory.nss = new Map();
debugFactory.enable = (namespace) => {
  ((namespace ? debugFactory.nss.get(namespace) : debugFactory) ?? debugFactory).enabled = true;
}
debugFactory.disable = (namespace) => {
  (namespace ? debugFactory.nss.get(namespace) : debugFactory).enabled = false;
}
debugFactory.enabled = true;
const debug = debugFactory;

const defaultSink = console.info.bind(console);

export { debug };
