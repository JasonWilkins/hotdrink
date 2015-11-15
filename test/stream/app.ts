class Greeter {
    element: HTMLElement;
    span: HTMLElement;
    timerToken: number;

    constructor(element: HTMLElement) {
        this.element = element;
        this.element.innerHTML += "The time is: ";
        this.span = document.createElement('span');
        this.element.appendChild(this.span);
        this.span.innerText = new Date().toUTCString();
    }

    start() {
        this.timerToken = setInterval(() => this.span.innerHTML = new Date().toUTCString(), 500);
    }

    stop() {
        clearTimeout(this.timerToken);
    }

}

var streamA: hd.stream.Stream<number> = new hd.stream.Stream<number>();
var streamB: hd.stream.Stream<number> = new hd.stream.Stream<number>();

function doA() {
	var txt = <HTMLInputElement>document.getElementById('A');
	streamA.send(Number(txt.value));
	txt.value = '';
}

function doB() {
	var txt = <HTMLInputElement>document.getElementById('B');
	streamB.send(Number(txt.value));
	txt.value = '';
}

function doC() {
	var txt = document.getElementById('C');
	hd.stream.invoke([streamA, streamB, txt], function (streamA, streamB, txt) {
		hd.stream.receive([streamA, streamB], function (a, b) {
			txt.value = txt.value + ' ' + String(a + b)
		});
	});
}

window.onload = () => {
    var el = document.getElementById('content');
    var greeter = new Greeter(el);
    greeter.start();
};
