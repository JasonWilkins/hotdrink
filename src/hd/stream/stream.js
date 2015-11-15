var hd;
(function (hd) {
    var stream;
    (function (stream) {
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
                this.streams = null;
            }
            Stream.prototype.send = function (item) {
                this.mailbox.enqueue(item);
                if (this.gather) {
                    try {
                        this.gather();
                    }
                    catch (ex) {
                        exHandler(this.streams, ex);
                    }
                }
            };
            Stream.prototype.kernel = function (a, b) {
                var readyThis = this;
                var readyFunc = (b instanceof Function) ? b : null;
                this.streams = (a instanceof Array) ? a : [];
                this.streams.concat([this]);
                for (var i = 0; i < this.streams.length; i++) {
                    this.streams[i].readyThis = readyThis;
                    this.streams[i].readyFunc = readyFunc;
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
            return Stream;
        })();
        stream.Stream = Stream;
        function receive(streams, func) {
            for (var i = 0; i < streams.length; i++) {
                if (streams[i].gather)
                    throw "Assertion Failed: Already Blocking";
            }
            function gather() {
                var isReady = true;
                for (var i = 0; i < streams.length; i++) {
                    isReady = isReady && streams[i].isReady();
                }
                if (isReady) {
                    var items = [];
                    for (var i = 0; i < streams.length; i++) {
                        items[i] = streams[i].mailbox.dequeue();
                        streams[i].gather = null;
                    }
                    func.apply(void 0, items);
                    throw new Ready;
                }
                else {
                    for (var i = 0; i < streams.length; i++) {
                        streams[i].gather = gather;
                    }
                    throw new Waiting;
                }
            }
            gather();
        }
        stream.receive = receive;
        function invoke(args, method) {
            try {
                var result = method.apply(void 0, args);
            }
            catch (ex) {
                exHandler(getStreamArgs(args), ex);
            }
        }
        stream.invoke = invoke;
        function getStreamArgs() {
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i - 0] = arguments[_i];
            }
            var streams;
            var j = 0;
            for (var i = 0; i < args.length; i++) {
                if (args[i] instanceof Stream) {
                    streams[j++] = args[i];
                }
            }
            return streams;
        }
        function exHandler(streams, ex) {
            if (ex instanceof Waiting) {
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
    })(stream = hd.stream || (hd.stream = {}));
})(hd || (hd = {}));
//# sourceMappingURL=Stream.js.map