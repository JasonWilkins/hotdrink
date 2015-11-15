module hd.stream {

	class Ready { }
	class Waiting { }

	export class Stream<T> {
		mailbox: collections.Queue<T> = new collections.Queue<T>();

		gather: () => void = null;

		readyThis: Stream<any> = null;
		readyFunc: (func: (item: any) => void) => void = null;

		streams: Stream<any>[] = null;

		send(item: T): void {
			this.mailbox.enqueue(item);

			if (this.gather) {
				try {
					this.gather();
				}
				catch (ex) {
					exHandler(this.streams, ex);
				}
			}
		}

		kernel(readyFunc: ((item: any) => void)): void;
		kernel(streams: Stream<any>[], readyFunc ?: (item: any) => void): void;
		kernel(a: ((item: any) => void) | Stream<any>[], b?: (item: any) => void): void {
			var readyThis = this;
			var readyFunc = (b instanceof Function) ? b : null;

			this.streams = (a instanceof Array) ? a : [];
			this.streams.concat([this]);

			for (var i: number = 0; i < this.streams.length; i++) {
				this.streams[i].readyThis = readyThis;
				this.streams[i].readyFunc = readyFunc;
			}
		}

		receive(func: (item: T) => void): void {
			receive([this], function (...items: any[]): void {
				func(items[0]);
			});
		}

		isReady(): boolean {
			return !this.mailbox.isEmpty();
		}

	}

	export function receive(streams: Stream<any>[], func: (...items: any[]) => void): void {
		for (var i: number = 0; i < streams.length; i++) {
			if (streams[i].gather)
				throw "Assertion Failed: Already Blocking";
		}

		function gather(): void {
			var isReady: boolean = true;

			for(var i: number = 0; i < streams.length; i++) {
				isReady = isReady && streams[i].isReady();
			}

			if (isReady) {
				var items: any[] = [];

				for (var i: number = 0; i < streams.length; i++) {
					items[i] = streams[i].mailbox.dequeue();
					streams[i].gather = null;
				}

				func(...items);

				throw new Ready;
			}
			else {
				for (var i: number = 0; i < streams.length; i++) {
					streams[i].gather = gather;
				}

				throw new Waiting;
			}
		}

		gather();
	}

	export function invoke(args: any[], method: Function): void {

		try {
			var result = method(...args);
		}
		catch (ex) {
			exHandler(getStreamArgs(args), ex);
		}
	}

	function getStreamArgs(...args: any[]): Stream<any>[] {
		var streams: Stream<any>[];
		var j: number = 0;
		for (var i: number = 0; i < args.length; i++) {
			if (args[i] instanceof Stream) {
				streams[j++] = args[i];
			}
		}

		return streams;
	}

	function exHandler(streams: Stream<any>[], ex: any) {
		if (ex instanceof Waiting) {
			// no need to do anything
		}
		else if (ex instanceof Ready) {
			// continue
			if (streams && streams.length > 0 && streams[0].readyThis && streams[0].readyFunc)
				streams[0].readyThis.receive(streams[0].readyFunc);
		}
		else {
			// rethrow
			throw ex;
		}
	}

}
