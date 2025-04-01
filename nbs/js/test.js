debugger;
const stripAnsi = require('strip-ansi');
function test() {
  console.log("test() called");
  console.log(stripAnsi('\u001B[4mBridget\u001B[0m'));
}
export default test;
