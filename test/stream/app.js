var Greeter = (function () {
    function Greeter(element) {
        this.element = element;
        this.element.innerHTML += "The time is: ";
        this.span = document.createElement('span');
        this.element.appendChild(this.span);
        this.span.innerText = new Date().toUTCString();
    }
    Greeter.prototype.start = function () {
        var _this = this;
        this.timerToken = setInterval(function () { return _this.span.innerHTML = new Date().toUTCString(); }, 500);
    };
    Greeter.prototype.stop = function () {
        clearTimeout(this.timerToken);
    };
    return Greeter;
})();
var streamA = new hd.stream.Stream();
var streamB = new hd.stream.Stream();
var streamA1 = streamA.sharedCopy();
var streamB1 = streamB.sharedCopy();
var streamA2 = streamA.sharedCopy();
var streamB2 = streamB.sharedCopy();
function doA() {
    var txt = document.getElementById('A');
    var num = Number(txt.value);
    txt.value = '';
    streamA.send(num);
    var out = document.getElementById('Aout');
    out.innerText += ' ' + String(num);
}
function doB() {
    var txt = document.getElementById('B');
    var num = Number(txt.value);
    txt.value = '';
    streamB.send(num);
    var out = document.getElementById('Bout');
    out.innerText += ' ' + String(num);
}
function doC() {
    var txt = document.getElementById('C');
    hd.stream.invoke([streamA, streamB, txt], function (streamA, streamB, txt) {
        hd.stream.receive([streamA, streamB], function (a, b) {
            txt.value = txt.value + ' ' + String(a + b);
        });
    });
}
function pullCopy(stream, id) {
    var txt = document.getElementById(id);
    hd.stream.invoke([stream, txt], function (stream, txt) {
        hd.stream.receive([stream], function (item) {
            txt.value = txt.value + ' ' + String(item);
        });
    });
}
window.onload = function () {
    var el = document.getElementById('content');
    var greeter = new Greeter(el);
    greeter.start();
};
//# sourceMappingURL=app.js.map