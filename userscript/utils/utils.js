// import { default as Notice, } from './notice.js';

class Utils {
  constructor(dev = false) {
    console.debug = new Proxy(console.debug, {
      apply: function (target, thisArg, argumentsList) {
        if (dev) {
          return target.apply(thisArg, [`%cD(${Utils.logTime()}):`, 'background:whitesmoke; padding:0 2px;', ...argumentsList,]);
        }
        return null;
      },
    });

    console.log = new Proxy(console.log, {
      apply: function (target, thisArg, argumentsList) {
        if (dev) {
          return target.apply(thisArg, [`%cD(${Utils.logTime()}):`, 'background:whitesmoke; padding:0 2px;', ...argumentsList,]);
        }
        return null;
      },
    });

    console.debug('utils constructor');
  }

  static logTime() {
    const d = new Date();
    return `${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`;
  }
  // TODO
}

// export default Utils
