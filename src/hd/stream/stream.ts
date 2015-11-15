module hd.stream {

	class Ready { }
	class Waiting { }

	export class Stream<T> {
		mailbox: collections.Queue<T> = new collections.Queue<T>();

		gather: () => void = null;

		readyThis: Stream<any> = null;
		readyFunc: (func: (item: any) => void) => void = null;

		adjacency: Stream<any>[] = null;

        dups: Stream<T>[] = [this];

        send(item: T): void {
            collections.arrays.forEach(this.dups, function (dup: Stream<T>): boolean {
                dup.mailbox.enqueue(item);
                return true;
            });

			if (this.gather) {
				try {
					this.gather();
				}
				catch (ex) {
					exHandler(this.adjacency, ex);
				}
			}
		}

		kernel(readyFunc: ((item: any) => void)): void;
		kernel(adjacency: Stream<any>[], readyFunc ?: (item: any) => void): void;
		kernel(a: ((item: any) => void) | Stream<any>[], b?: (item: any) => void): void {
			var readyThis = this;
			var readyFunc = (b instanceof Function) ? b : null;

			this.adjacency = (a instanceof Array) ? a : [];
			this.adjacency.concat([this]);

			for (var i: number = 0; i < this.adjacency.length; i++) {
				this.adjacency[i].readyThis = readyThis;
				this.adjacency[i].readyFunc = readyFunc;
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

        sharedCopy(): Stream<T> {
            var stream = new Stream<T>();

            this.mailbox.forEach(function (item: T): boolean {
                stream.mailbox.enqueue(item);
                return true;
            });

            var merge = this.dups.concat(stream.dups);
            stream.dups = merge;
            this.dups = merge;

            return stream;
        }

    }

	export function receive(adjacency: Stream<any>[], func: (...items: any[]) => void): void {
		for (var i: number = 0; i < adjacency.length; i++) {
			if (adjacency[i].gather)
				throw "Assertion Failed: Already Blocking";
		}

		function gather(): void {
			var isReady: boolean = true;

			for(var i: number = 0; i < adjacency.length; i++) {
				isReady = isReady && adjacency[i].isReady();
			}

			if (isReady) {
				var items: any[] = [];

				for (var i: number = 0; i < adjacency.length; i++) {
					items[i] = adjacency[i].mailbox.dequeue();
					adjacency[i].gather = null;
				}

				func(...items);

				throw new Ready;
			}
			else {
				for (var i: number = 0; i < adjacency.length; i++) {
					adjacency[i].gather = gather;
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
		var adjacency: Stream<any>[];
		var j: number = 0;
		for (var i: number = 0; i < args.length; i++) {
			if (args[i] instanceof Stream) {
				adjacency[j++] = args[i];
			}
		}

		return adjacency;
	}

	function exHandler(adjacency: Stream<any>[], ex: any) {
		if (ex instanceof Waiting) {
			// no need to do anything
		}
		else if (ex instanceof Ready) {
			// continue
			if (adjacency && adjacency.length > 0 && adjacency[0].readyThis && adjacency[0].readyFunc)
				adjacency[0].readyThis.receive(adjacency[0].readyFunc);
		}
		else {
			// rethrow
			throw ex;
		}
	}

}
