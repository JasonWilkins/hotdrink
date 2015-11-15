var hd;
(function (hd) {
    var stream;
    (function (stream_1) {
        var Ready = (function () {
            function Ready() {
            }
            return Ready;
        })();
        var Waiting = (function () {
            function Waiting() {
            }
            return Waiting;
        })();
        var Stream = (function () {
            function Stream() {
                this.mailbox = new collections.Queue();
                this.gather = null;
                this.readyThis = null;
                this.readyFunc = null;
                this.adjacency = null;
                this.dups = [this];
            }
            Stream.prototype.send = function (item) {
                collections.arrays.forEach(this.dups, function (dup) {
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
            };
            Stream.prototype.kernel = function (a, b) {
                var readyThis = this;
                var readyFunc = (b instanceof Function) ? b : null;
                this.adjacency = (a instanceof Array) ? a : [];
                this.adjacency.concat([this]);
                for (var i = 0; i < this.adjacency.length; i++) {
                    this.adjacency[i].readyThis = readyThis;
                    this.adjacency[i].readyFunc = readyFunc;
                }
            };
            Stream.prototype.receive = function (func) {
                receive([this], function () {
                    var items = [];
                    for (var _i = 0; _i < arguments.length; _i++) {
                        items[_i - 0] = arguments[_i];
                    }
                    func(items[0]);
                });
            };
            Stream.prototype.isReady = function () {
                return !this.mailbox.isEmpty();
            };
            Stream.prototype.sharedCopy = function () {
                var stream = new Stream();
                this.mailbox.forEach(function (item) {
                    stream.mailbox.enqueue(item);
                    return true;
                });
                var merge = this.dups.concat(stream.dups);
                stream.dups = merge;
                this.dups = merge;
                return stream;
            };
            return Stream;
        })();
        stream_1.Stream = Stream;
        function receive(adjacency, func) {
            for (var i = 0; i < adjacency.length; i++) {
                if (adjacency[i].gather)
                    throw "Assertion Failed: Already Blocking";
            }
            function gather() {
                var isReady = true;
                for (var i = 0; i < adjacency.length; i++) {
                    isReady = isReady && adjacency[i].isReady();
                }
                if (isReady) {
                    var items = [];
                    for (var i = 0; i < adjacency.length; i++) {
                        items[i] = adjacency[i].mailbox.dequeue();
                        adjacency[i].gather = null;
                    }
                    func.apply(void 0, items);
                    throw new Ready;
                }
                else {
                    for (var i = 0; i < adjacency.length; i++) {
                        adjacency[i].gather = gather;
                    }
                    throw new Waiting;
                }
            }
            gather();
        }
        stream_1.receive = receive;
        function invoke(args, method) {
            try {
                var result = method.apply(void 0, args);
            }
            catch (ex) {
                exHandler(getStreamArgs(args), ex);
            }
        }
        stream_1.invoke = invoke;
        function getStreamArgs() {
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i - 0] = arguments[_i];
            }
            var adjacency;
            var j = 0;
            for (var i = 0; i < args.length; i++) {
                if (args[i] instanceof Stream) {
                    adjacency[j++] = args[i];
                }
            }
            return adjacency;
        }
        function exHandler(adjacency, ex) {
            if (ex instanceof Waiting) {
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
    })(stream = hd.stream || (hd.stream = {}));
})(hd || (hd = {}));
//# sourceMappingURL=stream.js.map