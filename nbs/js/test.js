debugger;
var stripAnsi = require_strip_ansi();
function test() {
  console.log("test() called");
  console.log(stripAnsi("\x1B[4mBridget\x1B[0m"));
}
var test_default = test;
export {
  test_default as default
};
