/* global CodeMirror prefs loadScript editor editors */

'use strict';

(function () {
  // CodeMirror miserably fails on keyMap='' so let's ensure it's not
  if (!prefs.get('editor.keyMap')) {
    prefs.reset('editor.keyMap');
  }

  const defaults = {
    mode: 'css',
    lineNumbers: true,
    lineWrapping: prefs.get('editor.lineWrapping'),
    foldGutter: true,
    gutters: [
      'CodeMirror-linenumbers',
      'CodeMirror-foldgutter',
      ...(prefs.get('editor.linter') ? ['CodeMirror-lint-markers'] : []),
    ],
    matchBrackets: true,
    highlightSelectionMatches: {showToken: /[#.\-\w]/, annotateScrollbar: true},
    hintOptions: {},
    lintReportDelay: prefs.get('editor.lintReportDelay'),
    styleActiveLine: true,
    theme: 'default',
    keyMap: prefs.get('editor.keyMap'),
    extraKeys: Object.assign(CodeMirror.defaults.extraKeys || {}, {
      // independent of current keyMap
      'Alt-Enter': 'toggleStyle',
      'Alt-PageDown': 'nextEditor',
      'Alt-PageUp': 'prevEditor',
      // show the hotkey in keymap info popup by adding a dummy command
      // TODO: implement as a normal command when CodeMirror is fixed
      'Ctrl-Pause': 'toggleEditorFocus',
    }),
    maxHighlightLength: 100e3,
    configureMouse: (cm, repeat) => repeat === 'double' ? {unit: selectTokenOnDoubleclick} : {},
  };

  Object.assign(CodeMirror.defaults, defaults, prefs.get('editor.options'));

  CodeMirror.commands.blockComment = cm => {
    cm.blockComment(cm.getCursor('from'), cm.getCursor('to'), {fullLines: false});
  };

  // Ctrl-Pause defocuses/focuses the editor
  addEventListener('keydown', event => {
    if (event.code === 'Pause' && event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      const cm = window.editors && (editors.lastActive || editors[0]) || ($('.CodeMirror') || {}).CodeMirror;
      if (cm && cm.hasFocus()) {
        setTimeout(() => cm.display.input.blur());
      } else if (cm) {
        cm.focus();
      }
    }
  }, true);

  // 'basic' keymap only has basic keys by design, so we skip it

  const extraKeysCommands = {};
  Object.keys(CodeMirror.defaults.extraKeys).forEach(key => {
    extraKeysCommands[CodeMirror.defaults.extraKeys[key]] = true;
  });
  if (!extraKeysCommands.jumpToLine) {
    CodeMirror.keyMap.sublime['Ctrl-G'] = 'jumpToLine';
    CodeMirror.keyMap.emacsy['Ctrl-G'] = 'jumpToLine';
    CodeMirror.keyMap.pcDefault['Ctrl-J'] = 'jumpToLine';
    CodeMirror.keyMap.macDefault['Cmd-J'] = 'jumpToLine';
  }
  if (!extraKeysCommands.autocomplete) {
    // will be used by 'sublime' on PC via fallthrough
    CodeMirror.keyMap.pcDefault['Ctrl-Space'] = 'autocomplete';
    // OSX uses Ctrl-Space and Cmd-Space for something else
    CodeMirror.keyMap.macDefault['Alt-Space'] = 'autocomplete';
    // copied from 'emacs' keymap
    CodeMirror.keyMap.emacsy['Alt-/'] = 'autocomplete';
    // 'vim' and 'emacs' define their own autocomplete hotkeys
  }
  if (!extraKeysCommands.blockComment) {
    CodeMirror.keyMap.sublime['Shift-Ctrl-/'] = 'blockComment';
  }

  if (navigator.appVersion.includes('Windows')) {
    // 'pcDefault' keymap on Windows should have F3/Shift-F3/Ctrl-R
    if (!extraKeysCommands.findNext) {
      CodeMirror.keyMap.pcDefault['F3'] = 'findNext';
    }
    if (!extraKeysCommands.findPrev) {
      CodeMirror.keyMap.pcDefault['Shift-F3'] = 'findPrev';
    }
    if (!extraKeysCommands.replace) {
      CodeMirror.keyMap.pcDefault['Ctrl-R'] = 'replace';
    }

    // try to remap non-interceptable Ctrl-(Shift-)N/T/W hotkeys
    ['N', 'T', 'W'].forEach(char => {
      [
        {from: 'Ctrl-', to: ['Alt-', 'Ctrl-Alt-']},
        // Note: modifier order in CodeMirror is S-C-A
        {from: 'Shift-Ctrl-', to: ['Ctrl-Alt-', 'Shift-Ctrl-Alt-']}
      ].forEach(remap => {
        const oldKey = remap.from + char;
        Object.keys(CodeMirror.keyMap).forEach(keyMapName => {
          const keyMap = CodeMirror.keyMap[keyMapName];
          const command = keyMap[oldKey];
          if (!command) {
            return;
          }
          remap.to.some(newMod => {
            const newKey = newMod + char;
            if (!(newKey in keyMap)) {
              delete keyMap[oldKey];
              keyMap[newKey] = command;
              return true;
            }
          });
        });
      });
    });
  }

  Object.assign(CodeMirror.mimeModes['text/css'].propertyKeywords, {
    'mix-blend-mode': true,
    'isolation': true,
  });
  Object.assign(CodeMirror.mimeModes['text/css'].valueKeywords, {
    'isolate': true,
  });
  Object.assign(CodeMirror.mimeModes['text/css'].colorKeywords, {
    'darkgrey': true,
    'darkslategrey': true,
    'dimgrey': true,
    'grey': true,
    'lightgrey': true,
    'lightslategrey': true,
    'slategrey': true,
  });

  const MODE = {
    stylus: 'stylus',
    uso: 'css'
  };

  CodeMirror.defineExtension('setPreprocessor', function (preprocessor, force = false) {
    const mode = MODE[preprocessor] || 'css';
    if ((this.doc.mode || {}).name === mode && !force) {
      return Promise.resolve();
    }
    if (mode === 'css') {
      this.setOption('mode', mode);
      return Promise.resolve();
    }
    return loadScript(`/vendor/codemirror/mode/${mode}/${mode}.js`).then(() => {
      this.setOption('mode', mode);
    });
  });

  CodeMirror.defineExtension('isBlank', function () {
    // superfast checking as it runs only until the first non-blank line
    let isBlank = true;
    this.doc.eachLine(line => {
      if (line.text && line.text.trim()) {
        isBlank = false;
        return true;
      }
    });
    return isBlank;
  });

  function selectTokenOnDoubleclick(cm, pos) {
    let {ch} = pos;
    const {line, sticky} = pos;
    const {text, styles} = cm.getLineHandle(line);

    const execAt = (rx, i) => (rx.lastIndex = i) && null || rx.exec(text);
    const at = (rx, i) => (rx.lastIndex = i) && null || rx.test(text);
    const atWord = ch => at(/\w/uy, ch);
    const atSpace = ch => at(/\s/uy, ch);

    const atTokenEnd = styles.indexOf(ch, 1);
    ch += atTokenEnd < 0 ? 0 : sticky === 'before' && atWord(ch - 1) ? 0 : atSpace(ch + 1) ? 0 : 1;
    ch = Math.min(text.length, ch);
    const type = cm.getTokenTypeAt({line, ch: ch + (sticky === 'after' ? 1 : 0)});
    if (atTokenEnd > 0) ch--;

    const isCss = type && !/^(comment|string)/.test(type);
    const isNumber = type === 'number';
    const isSpace = atSpace(ch);
    let wordChars =
      isNumber ? /[-+\w.%]/uy :
      isCss ? /[-\w@]/uy :
      isSpace ? /\s/uy :
      atWord(ch) ? /\w/uy : /[^\w\s]/uy;

    let a = ch;
    while (a && at(wordChars, a)) a--;
    a += !a && at(wordChars, a) || isCss && at(/[.!#@]/uy, a) ? 0 : at(wordChars, a + 1);

    let b, found;

    if (isNumber) {
      b = a + execAt(/[+-]?[\d.]+(e\d+)?|$/uyi, a)[0].length;
      found = b >= ch;
      if (!found) {
        a = b;
        ch = a;
      }
    }

    if (!found) {
      wordChars = isCss ? /[-\w]*/uy : new RegExp(wordChars.source + '*', 'uy');
      b = ch + execAt(wordChars, ch)[0].length;
    }

    return {
      from: {line, ch: a},
      to: {line, ch: b},
    };
  }
})();

// eslint-disable-next-line no-unused-expressions
CodeMirror.hint && (() => {
  const USO_VAR = 'uso-variable';
  const USO_VALID_VAR = 'variable-3 ' + USO_VAR;
  const USO_INVALID_VAR = 'error ' + USO_VAR;
  const RX_IMPORTANT = /(i(m(p(o(r(t(a(nt?)?)?)?)?)?)?)?)?(?=\b|\W|$)/iyu;

  const originalHelper = CodeMirror.hint.css || (() => {});
  CodeMirror.registerHelper('hint', 'css', function (cm) {
    const pos = cm.getCursor();
    const {line, ch} = pos;
    const {styles, text} = cm.getLineHandle(line);
    if (!styles) return originalHelper(cm);
    const {style, index} = cm.getStyleAtPos({styles, pos: ch}) || {};
    if (style && (style.startsWith('comment') || style.startsWith('string'))) {
      return originalHelper(cm);
    }
    if (text[ch - 1] === '!' && /i|\W|^$/iu.test(text[ch] || '')) {
      RX_IMPORTANT.lastIndex = ch;
      return {
        list: ['important'],
        from: pos,
        to: {line, ch: ch + RX_IMPORTANT.exec(text)[0].length},
      };
    }
    let prev = index > 2 ? styles[index - 2] : 0;
    let end = styles[index];
    if (text[prev] === '#') {
      return {list: [], from: pos, to: pos};
    }
    if (!editor || !style || !style.includes(USO_VAR)) {
      return originalHelper(cm);
    }
    const adjust = text[prev] === '/' ? 4 : 0;
    prev += adjust;
    end -= adjust;
    const leftPart = text.slice(prev, ch);
    const list = Object.keys(editor.getStyle().usercssData.vars)
      .filter(name => name.startsWith(leftPart));
    return {
      list,
      from: {line, ch: prev},
      to: {line, ch: end},
    };
  });

  const hooks = CodeMirror.mimeModes['text/css'].tokenHooks;
  const originalCommentHook = hooks['/'];
  hooks['/'] = tokenizeUsoVariables;

  function tokenizeUsoVariables(stream) {
    const token = originalCommentHook.apply(this, arguments);
    if (token[1] !== 'comment') {
      return token;
    }
    const {string, start, pos} = stream;
    // /*[[install-key]]*/
    // 01234          43210
    if (string[start + 2] === '[' &&
        string[start + 3] === '[' &&
        string[pos - 3] === ']' &&
        string[pos - 4] === ']') {
      const vars = typeof editor !== 'undefined' && (editor.getStyle().usercssData || {}).vars;
      const name = vars && string.slice(start + 4, pos - 4);
      if (vars && Object.hasOwnProperty.call(vars, name.endsWith('-rgb') ? name.slice(0, -4) : name)) {
        token[0] = USO_VALID_VAR;
      } else {
        token[0] = USO_INVALID_VAR;
      }
    }
    return token;
  }
})();
