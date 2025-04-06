import { expect } from 'chai';
import sinon from 'sinon';

// Import the module to test
import { debug as debugExt } from '../../src/utils.js';
import { ChangeCollatorVSCode, ChangeSummary, eventSummary } from '../../src/changeCollator.js';

// Mock vscode module
const vscode = {
  NotebookCellKind: {
    Markup: 1,
    Code: 2
  }
};

function mockCell(index, kind=vscode.NotebookCellKind.Code, metadata={}, outputs=[]) {
  return {
    index,
    kind,
    document: { 
      getText: () => `console.log("cell ${index}")`,
      uri: { fragment: `cell-${index}` }
    },
    outputs,
    metadata
  }
}

function mockNotebook(nCells=3) {
  return {
    uri: { toString: () => 'mock-notebook-uri' },
    cells: new Array(nCells).fill(0).map((_,i) => mockCell(i)),
    get cellCount() { return this.cells.length },
    cellAt: function(index) { return this.cells[index] },
    getCells: function() { return [...this.cells] },
    _delCells_: function(index, count) { 
      const cells = this.cells.splice(index, count);
      this.cells.forEach((c, i) => c.index = i);
      cells.forEach(c => c.index = -1);
      return cells;
    },
    _addCells_: function(index, cells) { 
      this.cells.splice(index, 0, ...cells); 
      this.cells.forEach((c, i) => c.index = i);
      return cells;
    }
  };
}

function event(notebook, { metadata, contentChanges, cellChanges }) {
  return {
    notebook: notebook,
    metadata: metadata,
    contentChanges: contentChanges || [],
    cellChanges: cellChanges || []
  }
}

function cellChange({ index, document, metadata, outputs, executionSummary }) {
  return {
		cell: index === undefined ? { index: 1 } : isNaN(index) ? index : { index },
		document: document,
		metadata: metadata,
		outputs: outputs,
		executionSummary: executionSummary
  }
}

function contentChange(start, end, {  addedCells, removedCells }) {
  return {
    range: { start: start, end: end },
    addedCells: addedCells || [],
    removedCells: removedCells || []
  }
}

// ch_2_d_x  // not sure if this' possible
// cn_1_a_r

function eventSumm(nb, summ) {
  const pp = summ.trim().split(' ');  // event props
  const cellChanges = [], contentChanges = [];
  let count, n;
  pp.forEach(p => {
    const [type, ...rest] = p.split('_');
    if (type === 'ch') {
      const props = {};
      const [idx, ...chs] = rest;
      while (chs.length > 0) {
        const prop = chs.shift();
        switch (prop) {
          case 'd': props.document = true; break;
          case 'x': 
            props.executionSummary = {};
            const order = Number(chs[0]);
            if (!isNaN(order)) { 
              props.executionSummary.executionOrder = order; chs.shift();
              const success = chs[0];
              if (success === 'true' || success === 'false') { 
                props.executionSummary.success = success === 'true'; chs.shift(); 
              }
            };
            break;
          case 'm': 
            props.metadata = {};
            count = chs[0], n = Number(count);
            if (count === 'null') { props.metadata.execution_count = null; chs.shift(); }
            else if (!isNaN(n)) { props.metadata.execution_count = n; chs.shift(); }
            break;
          case 'o': 
            count = chs[0], n = Number(count);
            if (isNaN(n)) props.outputs = [];
            else { props.outputs = new Array(n).fill(1); chs.shift(); }
            break;
        }
      }
      const cell = nb.cellAt(idx);
      cellChanges.push(cellChange({ index:cell, ...props }));
    }
    else if (type === 'cn') {
      const [op, rr] = rest;
      const cc = rr.split(',').map(Number);
      const props = {start: cc[0]};
      switch (op) {
        case 'r': 
          props.end = cc[1];
          props.removedCells = nb._delCells_(cc[0], cc[1] - cc[0]);
          break;
        case 'a': 
          props.end = props.start;
          props.addedCells = nb._addCells_(cc[0], cc.map(i => mockCell(i)));
          break;
      }
      contentChanges.push(contentChange(props.start, props.end, props));
    }
  });
  return event(nb, { 
    cellChanges: cellChanges.length > 0 ? cellChanges : undefined, 
    contentChanges: contentChanges.length > 0 ? contentChanges : undefined });
}

describe('ChangeCollator', () => {
  let collator;
  beforeEach(() => {
    collator = new ChangeCollatorVSCode(mockNotebook());
  });
  
  it('should summarize synthetic events', () => {
    collator.nb = mockNotebook(8);
    const synths = [
      'ch_2_d', 
      'ch_2_x', 'ch_2_x_2', 'ch_2_x_4_true', 
      'ch_2_x_d', 
      'ch_2_o', 'ch_2_o_1', 
      'ch_2_m', 'ch_2_m_null', 'ch_3_m_null ch_2_m_null', 'ch_2_m_3', 'ch_2_x_5_m_5', 
      'ch_1_d ch_2_x ch_3_o',
      'cn_r_2,3', 'cn_r_4,5 cn_r_2,3',
      'cn_a_2', 'cn_a_2,3', 'cn_a_2 cn_a_4',
      'cn_r_5,6 cn_r_2,4', 'cn_a_2,3 cn_a_5',
      // 'ch_2_d | cn_r_2,3', 
    ];
    synths.forEach(synth => {
      const evt = eventSumm(collator.nb, synth);
      const summ = eventSummary(evt);
      expect(summ).to.equal(synth);
    });
  });

  it('should initialize with an empty state', () => {
    expect(collator.size).to.equal(0);
    expect(collator.cellCount).to.equal(collator.nb.cellCount);
    expect(collator.isEmpty).to.be.true;
    expect(collator.hasDiffs).to.be.false;
    expect(collator.getDiffs()).to.be.an('array').that.is.empty;
    expect(collator.events).to.be.an('array').that.is.empty;
  });
  
  it('should track document changes', () => {
    collator.addEvent(eventSumm(collator.nb, 'ch_1_d'));
    expect(collator.hasDocumentChanges).to.be.true;
    expect(collator.get(1).document).to.be.true;
  });

  it('should accumulate events (added/removed cells)', () => {
    [ 'cn_a_1,2', 'cn_r_1,2' ].forEach(evt => {
      collator.addEvent(eventSumm(collator.nb, evt));
    });
    if (debugExt.enabled) expect(collator.events.length).to.equal(2);
  });

  it('should track content changes: add cells', () => {
    collator.addEvent(eventSumm(collator.nb, 'cn_a_1,2'));
    expect(collator.cellCount).to.equal(collator.nb.cellCount);
    const changes = collator.getDiffs();
    expect(changes.length).to.equal(1);
    const [full, added, removed] = changes[0];
    expect(added.length).to.equal(1);
    expect(added[0]).to.deep.equal({start: 1, cellIdxs: [1, 2]});
  });

  it('should track content changes: remove cells', () => {
    collator.addEvent(eventSumm(collator.nb, 'cn_r_1,2'));
    expect(collator.cellCount).to.equal(collator.nb.cellCount);
    const changes = collator.getDiffs();
    expect(changes.length).to.equal(1);
    const [full, added, removed] = changes[0];
    expect(removed).to.be.an('array'); // removed cells
    expect(removed[0]).to.deep.include({ start: 1, end: 2 });
  });

  it('should track execution summary changes', () => {
    [ 'ch_1_x', 'ch_1_x_1_true' ].forEach(evt => {
      collator.addEvent(eventSumm(collator.nb, evt));
    });
    const chs = collator.get(1);
    expect(chs.executionSummary.executionOrder).to.equal(1);
    expect(chs.executionSummary.success).to.be.true;
  });

  it('should handle metadata changes', () => {
    [ 'ch_1_x', 'ch_1_x_1', 'ch_1_x_1_true', 'ch_1_m_1', ].forEach(evt => {
      collator.addEvent(eventSumm(collator.nb, evt));
    });
    expect(collator.hasDiffs).to.be.true;
    const changes = collator.getDiffs();
    expect(changes.length).to.equal(1);
    const [full, added, removed] = changes[0];
    expect(full).to.exist;
    expect(full.length).to.equal(1);
    expect(full[0]).to.equal(1);
  });

  it('should remove dangling events', () => {
    [
      'ch_2_x_2_true',  // dangling exe - skipped
      'ch_1_m_null',    // dangling metadata - skipped
      'ch_2_m_5',       // dangling metadata - skipped
    ].forEach(evt => {
      collator.addEvent(eventSumm(collator.nb, evt));
    });
    expect(collator.hasDiffs).to.be.false;
    expect(collator.isEmpty).to.be.true;
  });

  it('should track cell changes: exe single cell', () => {
    // w/o metadata changes
    [
      'ch_1_x', 'ch_1_x',
      'ch_1_x_1', 'ch_1_x_1', 'ch_1_x_1',
    ].forEach(evt => {
      collator.addEvent(eventSumm(collator.nb, evt));
    });
    // mock missing metadata event
    collator.nb.cells[1].metadata.execution_count = 1;
    collator.addEvent(eventSumm(collator.nb, 'ch_1_x_1_true'));
    expect(collator.hasDiffs).to.be.true;
    expect(collator.getDiffs()).to.deep.equal([[[1], [], []]]);
    expect(collator.isEmpty).to.be.true;

    // metadata changes
    [
      'ch_1_x', 'ch_1_x',
      'ch_1_x_2', 'ch_1_x_2', 'ch_1_x_2',
      'ch_1_x_2_true',
      'ch_1_m_2',
    ].forEach(evt => {
      collator.addEvent(eventSumm(collator.nb, evt));
    });
    expect(collator.hasDiffs).to.be.true;
    expect(collator.getDiffs()).to.deep.equal([[[1], [], []]]);
    expect(collator.isEmpty).to.be.true;
  });

  it('should track cell changes: outputs', () => {
    [
      'ch_2_x', 'ch_2_x',
      'ch_2_x_3', 'ch_2_x_3', 'ch_2_x_3',
      'ch_2_o',
      'ch_2_x_3_true',
      'ch_2_m_3',
      'ch_2_x_3_true',
    ].forEach(evt => { 
      collator.addEvent(eventSumm(collator.nb, evt));
    });
    expect(collator.hasDiffs).to.be.true;
    expect(collator.getDiffs()).to.deep.equal([[[2], [], []]]);
    expect(collator.isEmpty).to.be.true;

    [
      'ch_1_x',
      'ch_1_x',
      'ch_1_x_14',
      'ch_1_x_14',
      'ch_1_o',
      'ch_1_m_null',
      'ch_1_x_14',
      'ch_1_o_1',
      'ch_1_x_14_true',
      'ch_1_x_14_true',
      'ch_1_m_14',
      'ch_1_m_14',
    ].forEach(evt => { 
      collator.addEvent(eventSumm(collator.nb, evt));
    });
    expect(collator.hasDiffs).to.be.true;
    expect(collator.getDiffs()).to.deep.equal([[[1], [], []]]);
    expect(collator.isEmpty).to.be.true;
  });

  it('should track cell changes: remove cells', () => {
    collator.nb = mockNotebook(6);
    collator.addEvent(eventSumm(collator.nb, 'cn_r_2,3'));
    expect(collator.cellCount).to.equal(collator.nb.cellCount);
    expect(collator.hasDiffs).to.be.true;
    let diffs = collator.getDiffs();
    expect(diffs).to.deep.equal([[[], [], [{start: 2, end: 3}]]]);
    expect(collator.isEmpty).to.be.true;

    collator.addEvent(eventSumm(collator.nb, 'cn_r_4,5 cn_r_2,3'));
    expect(collator.cellCount).to.equal(collator.nb.cellCount);
    expect(collator.hasDiffs).to.be.true;
    diffs = collator.getDiffs();
    expect(diffs).to.deep.equal([[[], [], [{start: 4, end: 5}, {start: 2, end: 3}]]]);
    expect(collator.isEmpty).to.be.true;
  });

  it('should track cell changes: remove + undo', () => {
    collator.nb = mockNotebook(6);
    collator.addEvent(eventSumm(collator.nb, 'cn_r_2,3'));
    expect(collator.cellCount).to.equal(collator.nb.cellCount);
    expect(collator.hasDiffs).to.be.true;
    let diffs = collator.getDiffs();
    expect(diffs).to.deep.equal([[[], [], [{start: 2, end: 3}]]]);
    expect(collator.isEmpty).to.be.true;

    collator.addEvent(eventSumm(collator.nb, 'cn_a_2'));
    expect(collator.cellCount).to.equal(collator.nb.cellCount);
    expect(collator.hasDiffs).to.be.true;
    diffs = collator.getDiffs();
    expect(diffs).to.deep.equal([[[], [{start: 2, cellIdxs: [2]}], []]]);
    expect(collator.isEmpty).to.be.true;

    collator.addEvent(eventSumm(collator.nb, 'cn_r_4,5 cn_r_2,3'));
    expect(collator.cellCount).to.equal(collator.nb.cellCount);
    expect(collator.hasDiffs).to.be.true;
    diffs = collator.getDiffs();
    expect(diffs).to.deep.equal([[[], [], [{start: 4, end: 5}, {start: 2, end: 3}]]]);
    expect(collator.isEmpty).to.be.true;

    collator.addEvent(eventSumm(collator.nb, 'cn_a_2 cn_a_4'));
    expect(collator.cellCount).to.equal(collator.nb.cellCount);
    expect(collator.hasDiffs).to.be.true;
    diffs = collator.getDiffs();
    expect(diffs).to.deep.equal([[[], [{start: 2, cellIdxs: [2]}, {start: 4, cellIdxs: [4]}], []]]);
    expect(collator.isEmpty).to.be.true;    
  });

  it('should track cell changes: remove + paste', () => {
    collator.nb = mockNotebook(6);
    collator.addEvent(eventSumm(collator.nb, 'cn_r_2,3'));
    expect(collator.cellCount).to.equal(collator.nb.cellCount);
    expect(collator.hasDiffs).to.be.true;
    let diffs = collator.getDiffs();
    expect(diffs).to.deep.equal([[[], [], [{start: 2, end: 3}]]]);
    expect(collator.isEmpty).to.be.true;

    // add cell 3 (or copy/paste a cell to position 3)
    collator.addEvents([
      eventSumm(collator.nb, 'cn_a_3'), 
      eventSumm(collator.nb, 'ch_3_m_null')
    ]);
    expect(collator.cellCount).to.equal(collator.nb.cellCount);
    expect(collator.hasDiffs).to.be.true;
    diffs = collator.getDiffs();
    expect(diffs).to.deep.equal([[[], [{start: 3, cellIdxs: [3]}], []]]);
    expect(collator.isEmpty).to.be.true;

    collator.addEvent(eventSumm(collator.nb, 'cn_r_4,5 cn_r_2,3'));
    expect(collator.cellCount).to.equal(collator.nb.cellCount);
    expect(collator.hasDiffs).to.be.true;
    diffs = collator.getDiffs();
    expect(diffs).to.deep.equal([[[], [], [{start: 4, end: 5}, {start: 2, end: 3}]]]);
    expect(collator.isEmpty).to.be.true;

    collator.addEvents([
      eventSumm(collator.nb, 'cn_a_3,4'), 
      eventSumm(collator.nb, 'ch_4_m_null ch_3_m_null')
    ]);
    expect(collator.cellCount).to.equal(collator.nb.cellCount);
    expect(collator.hasDiffs).to.be.true;
    diffs = collator.getDiffs();
    expect(diffs).to.deep.equal([[[], [{start: 3, cellIdxs: [3,4]}], []]]);
    expect(collator.isEmpty).to.be.true;
  });

  it('should track cell changes: typing & exe 1', () => {
    const evts = [
      'ch_2_d', 'ch_2_d', 'ch_2_d',
      'ch_2_x', 'ch_2_x',
      'ch_2_x_1', 'ch_2_x_1',
      'ch_2_o',
      'ch_2_x_1_true',
      'ch_2_m_1',
      'ch_2_x_1_true'
    ];
    evts.forEach(evt => {
      collator.addEvent(eventSumm(collator.nb, evt));
    });
    expect(collator.hasDiffs).to.be.true;
    const diffs = collator.getDiffs();
    expect(diffs).to.deep.equal([[[2], [], []]]);
    expect(collator.isEmpty).to.be.true;
  });

  it('should track cell changes: typing & exe 2', () => {
    collator.nb = mockNotebook(4);
    const evts = [
      'ch_2_d', 'ch_2_d', 'ch_2_d',
      'ch_2_x', 'ch_2_x',
      'ch_2_x_2', 'ch_2_x_2',
      'ch_2_o',
      'ch_2_x_2_true', 'ch_2_x_2_true',
      'ch_2_m_2', 'ch_2_m_2',
      'ch_3_x', 'ch_3_x',
      'ch_3_x_3', 'ch_3_x_3',
      'ch_3_o',
      'ch_3_x_3_true',
      'ch_3_m_3',
    ];
    evts.forEach(evt => {
      collator.addEvent(eventSumm(collator.nb, evt));
    });
    expect(collator.hasDiffs).to.be.true;
    const diffs = collator.getDiffs();
    expect(diffs).to.deep.equal([[[2,3], [], []]]);
    expect(collator.isEmpty).to.be.true;
  });

  it('should track cell changes: typing & del & exe', () => {
    collator.nb = mockNotebook(4);
    [
      'ch_2_d', 'ch_2_d', 'ch_2_d', 'ch_2_d',  // cell 2 edits
      'cn_r_2,3',                              // cell 2 del
      'ch_2_x', 'ch_2_x',                      // cell 2 exe (prev cell 3)
      'ch_2_x_2', 'ch_2_x_2',
      'ch_2_o',
      'ch_2_x_2_true',
      'ch_2_m_2',
    ].forEach(evt => {
      collator.addEvent(eventSumm(collator.nb, evt));
    });
    expect(collator.hasDiffs).to.be.true;
    const diffs = collator.getDiffs();
    expect(collator.nb.cellCount).to.equal(3);
    expect(diffs).to.deep.equal([
      [[2], [], []],  // cell 2 edits
      [[2], [], [{start: 2, end: 3}]]  // cell 2 del & cell 2 exe (prev cell 3)
    ]);
    expect(collator.isEmpty).to.be.true;
  });

  it('should track cell changes: all above', () => {
    collator.nb = mockNotebook(10);
    [
      'ch_1_x', 'ch_2_x', 'ch_3_x', 'ch_4_x', 'ch_5_x', 'ch_6_x',
      'ch_1_x',
      'ch_1_x_1', 'ch_1_x_1',
    ].forEach(evt => {
      collator.addEvent(eventSumm(collator.nb, evt));
    });
    // mock missing metadata event
    collator.nb.cells[1].metadata.execution_count = 1;
    [
      'ch_1_x_1_true',
      'ch_2_x',
      'ch_2_x_2', 'ch_2_x_2',
      'ch_2_o',
      'ch_2_x_2_true', 'ch_2_x_2_true',
      'ch_3_x',
      'ch_3_x_3', 'ch_3_x_3',
      'ch_3_o',
      'ch_3_x_3_true',
      'ch_4_x',
      'ch_4_x_4', 'ch_4_x_4',
      'ch_2_m_2', 'ch_2_m_2',
      'ch_4_x_4',
      'ch_4_o',
      'ch_4_x_4_true',
      'ch_3_m_3',
      'ch_5_x',
      'ch_5_x_5', 'ch_5_x_5',
      'ch_5_o',
      'ch_5_x_5_true',
      'ch_6_x',
      'ch_6_x_6', 'ch_6_x_6',
      'ch_6_o',
      'ch_6_x_6_true',
      'ch_4_m_4',
      'ch_5_m_5',
      'ch_6_m_6',
    ].forEach(evt => {
      collator.addEvent(eventSumm(collator.nb, evt));
    });
    expect(collator.hasDiffs).to.be.true;
    const diffs = collator.getDiffs();
    expect(diffs).to.deep.equal([[[1,2,3,4,5,6], [], []]]);
    expect(collator.isEmpty).to.be.true;
  });

  it('should track cell changes: clear outputs', () => {
    // mock outputs
    collator.nb.cells[1].outputs = [1];
    [
      'ch_1_o',         // dangling empty outputs - should happen only when clearing outputs
                        // skipped if cell has no outputs (shouldn't happen)
      'ch_1_x',         // skipped
      'ch_1_m_null',    // skipped
      'ch_1_m_null',    // skipped

      'ch_2_x_2_true',  // dangling exe - skipped
      'ch_2_o',         // dangling empty outputs - skipped
      'ch_2_x',         // dangling cell 2 exe - skipped
      'ch_2_m_null',    // dangling metadata - skipped
      'ch_2_m_null',    // dangling metadata - skipped
    ].forEach(evt => {
      collator.addEvent(eventSumm(collator.nb, evt));
    });
    expect(collator.hasDiffs).to.be.true;
    let diffs = collator.getDiffs();
    expect(diffs).to.deep.equal([[[1,2], [], []]]);
    expect(collator.isEmpty).to.be.true;
  });

});


/*
matplotlib
1741027597502 nbinspect:monitor .......... e: ch_14_x
          +15 nbinspect:monitor .......... e: ch_14_x
           +2 nbinspect:monitor .......... e: ch_14_x_14
           +1 nbinspect:monitor .......... e: ch_14_x_14
           +7 nbinspect:monitor .......... e: ch_14_o
1741027605464 nbinspect:monitor .......... e: ch_14_m_null
           +3 nbinspect:monitor .......... e: ch_14_x_14
           +2 nbinspect:monitor .......... e: ch_14_o_1
1741027617234 nbinspect:monitor .......... e: ch_14_x_14_true
           +3 nbinspect:monitor .......... e: ch_14_x_14_true
          +18 nbinspect:monitor .......... e: ch_14_m_14
           +3 nbinspect:monitor .......... e: ch_14_m_14
1741027617359 nbinspect:coll **** changes ---- (7) ---- ****
fullCells: 14
full 14 { d: - o: ✓ md: {"execution_count":14,"metadata":{"brd":"19c7e50b-2c75-4b36-9f26-7e0b131e64c7"}}
          ex: {"timing":{"startTime":1741027597515,"endTime":1741027605460},"executionOrder":14,"success":true} }
 1741027597503 14 { d: - o: - md: - ex: {} }
           +17 14 { d: - o: - md: - ex: {"executionOrder":14} }
            +8 14 { d: - o: ✓ md: - ex: - }
         +7937 14 { d: - o: - md: {"execution_count":null,"metadata":{"brd":"19c7e50b-2c75-4b36-9f26-7e0b131e64c7"}} ex: - }
            +4 14 { d: - o: ✓ md: - ex: - }
        +11765 14 { d: - o: - md: - ex: {"timing":{"startTime":1741027597515,"endTime":1741027605460},"executionOrder":14,"success":true} }
           +22 14 { d: - o: - md: {"execution_count":14,"metadata":{"brd":"19c7e50b-2c75-4b36-9f26-7e0b131e64c7"}} ex: - }
           +1 nbinspect:coll **** ---------------------------- ****
         +103 nbinspect:monitor >>>> NBStateDiff changed: [14]   ts: 1741027617361
           +0 nbinspect:monitor >>>> pending
     ____ empty collator ____
*/

/*
clear outputs

1741030507411 nbinspect:monitor .......... e: ch_2_o
           +1 nbinspect:monitor .......... e: ch_2_x

1741027847980 nbinspect:monitor .......... e: ch_14_o
           +2 nbinspect:monitor .......... e: ch_14_x
          +30 nbinspect:monitor .......... e: ch_14_m_null
           +1 nbinspect:monitor .......... e: ch_14_m_null
           
1741027862664 nbinspect:monitor .......... e: ch_2_x_2_true  
1741027870596 nbinspect:monitor .......... e: ch_2_o
           +2 nbinspect:monitor .......... e: ch_2_x
           +5 nbinspect:monitor .......... e: ch_2_m_null
           +1 nbinspect:monitor .......... e: ch_2_m_null
*/
