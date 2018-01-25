/*
global messageBox resolveWith
gloabl showHelp setCleanItem
global API_METHODS
*/
'use strict';

const exclusions = (() => {

  const popupWidth = '400px';

  // get exclusions from a select element
  function get(options = {}) {
    const lists = {};
    const excluded = options.exclusions || getMultiOptions(options);
    excluded.forEach(list => {
      lists[list] = createRegExp(list);
    });
    return lists;
  }

  function createRegExp(url) {
    // returning a regex string; Object.assign is used on style & doesn't save RegExp
    return url.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replace(/[*]/g, '.+?');
  }

  function getMultiOptions({select, selectedOnly, elements} = {}) {
    return [...(select || exclusions.select).children].reduce((acc, opt) => {
      if (selectedOnly && opt.selected) {
        acc.push(elements ? opt : opt.value);
      } else if (!selectedOnly) {
        acc.push(elements ? opt : opt.value);
      }
      return acc;
    }, []);
  }

  function populateSelect(options = []) {
    exclusions.select.textContent = '';
    const option = $create('option');
    options.forEach(value => {
      const opt = option.cloneNode();
      opt.value = value;
      opt.textContent = value;
      opt.title = value;
      exclusions.select.appendChild(opt);
    });
  }

  function openInputDialog({title, callback, value = ''}) {
    messageBox({
      title,
      className: 'center',
      contents: [
        $create('div', {id: 'excludedError', textContent: '\xa0\xa0'}),
        $create('input', {type: 'text', id: 'excluded-input', value})
      ],
      buttons: [t('confirmOK'), t('confirmCancel')]
    });
    setTimeout(() => {
      const btn = $('#message-box-buttons button', messageBox.element);
      // not using onkeyup here because pressing enter to activate add/edit
      // button fires onkeyup here when user releases the key
      $('#excluded-input').onkeydown = event => {
        if (event.which === 13) {
          event.preventDefault();
          callback.apply(btn);
        }
      };
      btn.onclick = callback;
    }, 1);
  }

  function validateURL(url) {
    const lists = getMultiOptions();
    // Generic URL globs; e.g. "https://test.com/*" & "*.test.com"
    return !lists.includes(url) && /^(?:https?:\/\/)?([\w*]+\.)+[\w*./-]+/.test(url);
  }

  function addExclusion() {
    openInputDialog({
      title: t('exclusionsAddTitle'),
      callback: function () {
        const value = $('#excluded-input').value;
        if (value && validateURL(value)) {
          exclusions.select.appendChild($create('option', {value, innerText: value}));
          done();
          messageBox.listeners.button.apply(this);
        } else {
          const errorBox = $('#excludedError', messageBox.element);
          errorBox.textContent = t('exclusionsInvalidUrl');
          setTimeout(() => {
            errorBox.textContent = '';
          }, 5000);
        }
      }
    });
  }

  function editExclusion() {
    const value = exclusions.select.value;
    if (value) {
      openInputDialog({
        title: t('exclusionsEditTitle'),
        value,
        callback: function () {
          const newValue = $('#excluded-input').value;
          // only edit the first selected option
          const option = getMultiOptions({selectedOnly: true, elements: true})[0];
          if (newValue && validateURL(newValue) && option) {
            option.value = newValue;
            option.textContent = newValue;
            option.title = newValue;
            if (newValue !== value) {
              exclusions.select.savedValue = ''; // make it dirty!
            }
            done();
            messageBox.listeners.button.apply(this);
          } else {
            const errorBox = $('#excludedError', messageBox.element);
            errorBox.textContent = t('exclusionsInvalidUrl');
            setTimeout(() => {
              errorBox.textContent = '';
            }, 5000);
          }
        }
      });
    }
  }

  function deleteExclusions() {
    const entries = getMultiOptions({selectedOnly: true, elements: true});
    if (entries.length) {
      messageBox
        .confirm(t('exclusionsDeleteConfirmation', [entries.length]))
        .then(ok => {
          if (ok) {
            entries.forEach(el => exclusions.select.removeChild(el));
            done();
          }
        });
    }
  }

  function excludeAction(event) {
    const target = event.target;
    if (target.id && target.id.startsWith('excluded-list-')) {
      // excluded-list-(add/edit/delete) -> ['excluded', 'list', 'add']
      const type = target.id.split('-')[2];
      switch (type) {
        case 'add':
          addExclusion();
          break;
        case 'edit':
          editExclusion();
          break;
        case 'delete':
          deleteExclusions();
          break;
      }
    }
  }

  function done() {
    // Make the style "dirty"
    exclusions.select.dispatchEvent(new Event('change'));
    updateStats();
  }

  function showExclusionHelp(event) {
    event.preventDefault();
    showHelp(t('exclusionsHelpTitle'), t('exclusionsHelp').replace(/\n/g, '<br>'), 'info');
  }

  /* Modal in Popup.html */
  function createPopupContent(url) {
    const results = [];
    const protocol = url.match(/\w+:\/\//);
    const parts = url.replace(/(\w+:\/\/|[#?].*$)/g, '').split('/');
    const domain = parts[0].split('.');
    /*
    Domain: a.b.com
    Domain: b.com
    Prefix: https://a.b.com
    Prefix: https://a.b.com/current
    Prefix: https://a.b.com/current/page
    */
    while (parts.length > 1) {
      results.push([t('excludedPrefix'), protocol + parts.join('/')]);
      parts.pop();
    }
    while (domain.length > 1) {
      results.push([t('excludedDomain'), domain.join('.')]);
      domain.shift();
    }
    return [
      $create('h2', {textContent: t('exclusionsEditTitle')}),
      $create('select', {
        id: 'popup-exclusions',
        size: results.length,
        multiple: 'true',
        value: ''
      }, [
        ...results.reverse().map(link => $create('option', {
          value: link[1],
          title: link[1],
          textContent: `${link[0]}: ${link[1]}`
        }))
      ])
    ];
  }

  function handlePopupSave(style, button) {
    const current = Object.keys(style.exclusions);
    const select = $('#popup-exclusions', messageBox.element);
    const all = getMultiOptions({select});
    const selected = getMultiOptions({select, selectedOnly: true});
    // Add exclusions
    selected.forEach(value => {
      let exists = exclusionExists(current, value);
      if (!exists.length) {
        style.exclusions[value] = createRegExp(value);
        exists = [''];
      }
      exists.forEach(ending => {
        const index = all.indexOf(value + ending);
        if (index > -1) {
          all.splice(index, 1);
        }
      });
    });
    // Remove exclusions (unselected in popup modal)
    all.forEach(value => {
      exclusionExists(current, value).forEach(ending => {
        delete style.exclusions[value + ending];
      });
    });
    style.method = 'styleUpdated';
    style.reason = 'editSave';
    API.saveStyle(style);
    messageBox.listeners.button.apply(button);
  }

  // return matches on url ending to prevent duplicates in the exclusion list
  // e.g. http://test.com and http://test.com/* are equivalent
  // this function would return ['', '/*']
  function exclusionExists(array, value) {
    const match = [];
    ['', '*', '/', '/*'].forEach(ending => {
      if (array.includes(value + ending)) {
        match.push(ending);
      }
    });
    return match;
  }

  function openPopupDialog(style, tabURL) {
    messageBox({
      title: style.name,
      className: 'center content-left',
      contents: createPopupContent(tabURL),
      buttons: [t('confirmOK'), t('confirmCancel')],
      onshow: box => {
        const contents = box.firstElementChild;
        contents.style = `max-width: calc(${popupWidth} - 20px); max-height: none;`;
        document.body.style.minWidth = popupWidth;
        document.body.style.minHeight = popupWidth;

        const select = $('select', messageBox.element);
        const exclusions = Object.keys(style.exclusions || {});
        [...select.children].forEach(option => {
          if (exclusionExists(exclusions, option.value).length) {
            option.selected = true;
          }
        }, []);
      }
    })
    .then(() => {
      document.body.style.minWidth = '';
      document.body.style.minHeight = '';
    });
    setTimeout(() => {
      $('#message-box-buttons button', messageBox.element).onclick = function () {
        handlePopupSave(style, this);
      };
    }, 1);
  }

  function updateStats() {
    if (exclusions.select) {
      const excludedTotal = exclusions.select.children.length;
      const none = excludedTotal === 0;
      exclusions.select.setAttribute('size', excludedTotal || 1);
      $('#excluded-stats').textContent = none ? '' : t('exclusionsStatus', [excludedTotal]);
      $('#excluded-list-edit').disabled = none;
      $('#excluded-list-delete').disabled = none;
    }
  }

  function onRuntimeMessage(msg) {
    if (msg.method === 'styleUpdated' && msg.style && msg.style.exclusions && exclusions.select) {
      update(Object.keys(msg.style.exclusions));
    }
  }

  function update(list = exclusions.list) {
    populateSelect(list);
    updateStats();
  }

  function init(style) {
    const list = Object.keys(style.exclusions || {});
    const size = list.length;
    exclusions.select = $('#excluded-list');
    exclusions.select.savedValue = String(size);
    exclusions.list = list;
    update();

    $('#excluded-wrap').onclick = excludeAction;
    $('#excluded-list-help').onclick = showExclusionHelp;
    document.head.appendChild($create('style', `
      #excluded-list:empty:after {
        content: "${t('exclusionsEmpty')}";
      }
    `));
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
  }

  return {init, get, update, openPopupDialog};
})();
