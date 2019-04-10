(function () {
  if (!Object.getOwnPropertySymbols(window).find(x => x === Symbol.for('notice+'))) {
    window[Symbol.for('notice+')] = new class {
      constructor() {
        this.styleNode = document.createElement('style');
        this.con = document.createElement('div');
        this.con.className = 'plus-utils-notice-container';
        this.styleNode.append('.plus-utils-notice-container{position:fixed;top:1ex;display:flex;right:14px;flex-direction:column;flex-wrap:nowrap;min-width:200px;max-width:calc(100% - 28px);height:fit-content;transition:all .3s;z-index:999}.plus-utils-notice-container ::selection{background-color:#f5f5f5}figure.plus-utils-notice-info{box-shadow:0 2px 7px 0 #00000007,0 2px 4px 0 #00000024,0 2px 7px 0 #00000007;padding:1ex;position:relative;margin:0 0 16px;border-radius:2px;animation:enter .5s;background-color:#fff}@keyframes enter{from{transform:translateX(120%)}}@keyframes outer{to{transform:translateX(120%)}}figure.plus-utils-notice-info>figcaption{display:flex;flex-wrap:nowrap;align-items:center;box-shadow:0 1px 0 #f5f5f5}figure.error>figcaption::before,figure.warn>figcaption::before,figure.info>figcaption::before{width:20px;height:20px}figure.info>figcaption::before{content:"";background-image:url("data:image/svg+xml;utf-8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'20\' height=\'20\'><circle cx=\'10\' cy=\'10\' r=\'10\' fill=\'%232196f3\' /><circle cx=\'10\' cy=\'4\' r=\'2\' fill=\'white\' /><path d=\'M8.5 8,l-0.5 8,q2 1 4 0,l-0.5 -8,q-2 0.5 -3 0\' fill=\'white\'/></svg>")}figure.error>figcaption::before{content:"";background-image:url("data:image/svg+xml;utf-8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'20\' height=\'20\'><circle cx=\'10\' cy=\'10\' r=\'10\' fill=\'%23F44336\' /><path d=\'M6 6,l8 8,m0 -8,l-8 8\' stroke=\'white\' stroke-width=\'2\'/></svg>")}figure.warn>figcaption::before{content:"";background-image:url("data:image/svg+xml;utf-8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'20\' height=\'20\' version=\'1.1\'><path d=\'M10 0,L0 20,L20 20z\' fill=\'%23f4c236\'/><path d=\'M9.5 4,l-1 8,q1.5 -0.5 3 0,l-1 -8,q-1.5 -0.5 -0.5 0\' fill=\'white\'/><circle cx=\'10\' cy=\'16\' r=\'2\' fill=\'white\'/></svg>")}figure.plus-utils-notice-info>figcaption>h3{margin:0 6px;flex-grow:1;max-width:100%;overflow:hidden;text-overflow:ellipsis}figure.plus-utils-notice-info>figcaption>i{justify-self:right;text-indent:0;cursor:pointer}figure.plus-utils-notice-info>p{color:gray;text-indent:6px;margin: 1ex 0;}');
        document.head.append(this.styleNode);
        document.documentElement.append(this.con);
      }

      notice(options) {
        let { message, title = 'notice', duration = 3000, type = '', } = {};
        if (typeof options == 'string' || options instanceof String) {
          message = options;
        } else {
          ({ message, title = 'notice', duration = 3000, type = '', } = options);
        }
        const figure = document.createElement('figure');
        const caption = document.createElement('figcaption');
        const captionContent = document.createElement('h3');
        const close = document.createElement('i');
        const content = document.createElement('p');
        close.innerHTML = '<svg width="24px" height="24px"><path d="M6 6, L18 18, M18 6, L6 18" stroke="black"></path></svg>';

        captionContent.textContent = title;
        content.textContent = message;

        figure.className = `plus-utils-notice-info ${type}`;
        caption.append(captionContent, close);
        figure.append(caption, content);

        this.con.append(figure);

        const remove = function () {
          {
            figure.style.animationName = 'outer';
            setTimeout(() => figure.remove(), 500);
          }
        };

        close.addEventListener('click', remove);
        if (duration > 0) {
          setTimeout(() => remove(), duration);
        }
      }

      info(options) {
        let { message, title = 'info', duration = 3000, } = {};
        if (typeof options == 'string' || options instanceof String) {
          message = options;
        } else {
          ({ message, title = 'info', duration = 3000, } = options);
        }
        console.log(title, message, duration);
        this.notice(title, message, duration, 'info');
      }

      warn(options) {
        let { message, title = 'warn', duration = 3000, } = {};
        if (typeof options == 'string' || options instanceof String) {
          message = options;
        } else {
          ({ message, title = 'warn', duration = 3000, } = options);
        }
        this.notice(title, message, duration, 'warn');
      }

      error(options) {
        let { message, title = 'warn', duration = 3000, } = {};
        if (typeof options == 'string' || options instanceof String) {
          message = options;
        } else {
          ({ message, title = 'warn', duration = 3000, } = options);
        }
        this.notice(title, message, duration, 'error');
      }
    };
  }
  // export default Notice
})();