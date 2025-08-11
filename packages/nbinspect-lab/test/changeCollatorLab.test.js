import { ChangeCollatorLab } from '../lib/changeCollatorLab.js';

// Mock JupyterLab dependencies
const mockCellModel = (id, index, type = 'code') => ({
  id,
  type,
  source: `console.log("cell ${index}")`,
  execution_count: null,
  outputs: { length: 0 },
  sharedModel: {
    changed: { connect: () => {}, disconnect: () => {} }
  }
});

const mockNotebookModel = (cellCount = 3) => {
  const cells = [];
  for (let i = 0; i < cellCount; i++) {
    cells.push(mockCellModel(`cell-${i}`, i));
  }
  
  return {
    cells: {
      length: cellCount,
      get: index => cells[index],
      changed: { connect: () => {}, disconnect: () => {} }
    }
  };
};

// Test the unified event pattern
function testUnifiedEventPattern() {
  console.log('🧪 Testing Unified Event Pattern...\n');
  
  const model = mockNotebookModel(3);
  const collator = new ChangeCollatorLab(model);
  
  console.log('✅ Created ChangeCollatorLab with 3 cells');
  console.log(`   Initial cell count: ${collator.cellCount}`);
  console.log(`   Is empty: ${collator.isEmpty}`);
  console.log();
  
  // Test 1: Cell change event
  console.log('📝 Test 1: Cell Change Event');
  const cellChangeEvent = {
    cellChanges: [
      {
        cell: model.cells.get(0),
        change: {
          executionStateChange: {
            oldValue: 'idle',
            newValue: 'running'
          }
        }
      }
    ],
    timestamp: Date.now()
  };
  
  collator.addEvent(cellChangeEvent);
  console.log(`   After cell change: isEmpty = ${collator.isEmpty}, size = ${collator.size}`);
  console.log();
  
  // Test 2: Content change event (add cell)
  console.log('➕ Test 2: Content Change Event (Add Cell)');
  const contentChangeEvent = {
    contentChanges: [{
      change: {
        type: 'add',
        newIndex: 3,
        newValues: [mockCellModel('cell-3', 3)],
        oldIndex: 3,
        oldValues: []
      }
    }],
    timestamp: Date.now()
  };
  
  collator.addEvent(contentChangeEvent);
  console.log(`   After content change: cellCount = ${collator.cellCount}`);
  console.log();
  
  // Test 3: Multiple events at once
  console.log('🔄 Test 3: Multiple Events');
  const multipleEvents = [
    {
      cellChanges: [{
        cell: model.cells.get(1),
        change: {
          outputsChange: {
            outputCount: 1,
            isEmpty: false
          }
        }
      }],
      timestamp: Date.now()
    },
    {
      cellChanges: [{
        cell: model.cells.get(0),
        change: {
          executionStateChange: {
            oldValue: 'running',
            newValue: 'idle'
          }
        }
      }],
      timestamp: Date.now()
    }
  ];
  
  collator.addEvents(multipleEvents);
  console.log(`   After multiple events: size = ${collator.size}`);
  console.log();
  
  // Test 4: Check for diffs
  console.log('📊 Test 4: Generate Diffs');
  if (collator.hasDiffs) {
    const diffs = collator.getDiffs();
    console.log(`   Generated ${diffs.length} diffs:`);
    diffs.forEach((diff, i) => {
      const [fullCells, added, removed, cellCount] = diff;
      console.log(`   Diff ${i + 1}: full=[${fullCells}], added=${added.length}, removed=${removed.length}, count=${cellCount}`);
    });
  } else {
    console.log('   No diffs generated');
  }
  console.log();
  
  // Test 5: Error handling
  console.log('❌ Test 5: Error Handling');
  try {
    collator.addEvent(null);
    console.log('   ✅ Handled null event gracefully');
  } catch (error) {
    console.log(`   ❌ Error with null event: ${error.message}`);
  }
  
  try {
    collator.addEvent({});
    console.log('   ✅ Handled empty event gracefully');
  } catch (error) {
    console.log(`   ❌ Error with empty event: ${error.message}`);
  }
  
  console.log('\n🎉 Unified Event Pattern Tests Complete!');
}

// Run tests if this file is executed directly
if (typeof window !== 'undefined') {
  // Browser environment
  window.testUnifiedEventPattern = testUnifiedEventPattern;
  console.log('🌐 Test function available as window.testUnifiedEventPattern()');
} else {
  // Node environment
  testUnifiedEventPattern();
} 