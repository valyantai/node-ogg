/**
 * Module dependencies.
 */

var debug = require('debug')('ogg:encoder-stream');
var binding = require('./binding');
var inherits = require('util').inherits;
var Writable = require('stream').Writable;

/**
 * Module exports.
 */

module.exports = EncoderStream;

function randomInt(high) {
  return Math.floor(Math.random() * high);
}

/**
 * The `EncoderStream` class abstracts the `ogg_stream` data structure when
 * used with the encoding interface. You should not need to create instances of
 * `EncoderStream` manually, instead, instances are returned from the
 * `Encoder#stream()` function.
 *
 * @api private
 */

function EncoderStream(serialno) {
  if (!(this instanceof EncoderStream)) return new EncoderStream(serialno);
  Writable.call(this, { objectMode: true, highWaterMark: 0 });

  if (null == serialno) {
    // TODO: better random serial number algo
    serialno = randomInt(1000000);
    debug('generated random serial number: %d', serialno);
  }
  this.serialno = serialno;
  this.os = new binding.ogg_stream_state(serialno);
}
inherits(EncoderStream, Writable);

EncoderStream.prototype.packetin = EncoderStream.prototype.write;

/**
 * Request that `ogg_stream_pageout()` be called on this stream.
 *
 * @param {Function} fn callback function
 * @api public
 */

EncoderStream.prototype.pageout = function(fn) {
  debug('pageout()');
  return this.write.call(this, { pageout: true }, fn);
};

/**
 * Request that `ogg_stream_flush()` be called on this stream.
 *
 * @param {Function} fn callback function
 * @api public
 */

EncoderStream.prototype.flush = function(fn) {
  debug('flush()');
  return this.write.call(this, { flush: true }, fn);
};

/**
 * Writable stream _write() callback function.
 * Takes the given `ogg_packet` and calls `ogg_stream_packetin()` on it.
 * If a "flush" or "pageout" command was given, then that function will be called
 * in an attempt to output any possible `ogg_page` instances.
 * it into an `ogg_page` instance.
 *
 * @param {Buffer} packet `ogg_packet` struct instance
 * @api private
 */

EncoderStream.prototype._write = function(packet, encoding, fn) {
  debug('_write()');
  // XXX: compat for old Writable API... remove at some point...
  if ('function' == typeof encoding) fn = encoding;

  var self = this;
  if (packet instanceof binding.ogg_packet) {
    // assumed to be an `ogg_packet` Buffer instance
    this._packetin(packet, checkCommand);
  } else {
    checkCommand();
  }
  function checkCommand(err) {
    if (err) return fn(err);
    debug('checking if "packet" contains a "pageout"/"flush" command');
    if (packet.flush) {
      self._flush(fn);
    } else if (packet.pageout) {
      self._pageout(fn);
    } else {
      // no command
      fn();
    }
  }
};

/**
 * Calls `ogg_stream_packetin()`.
 *
 * @api private
 */

EncoderStream.prototype._packetin = function(packet, fn) {
  debug('_packetin()');
  binding.ogg_stream_packetin(this.os, packet, function(rtn) {
    debug('ogg_stream_packetin() return = %d', rtn);
    if (0 === rtn) {
      fn();
    } else {
      fn(new Error(rtn));
    }
  });
};

/**
 * Calls `ogg_stream_pageout()` repeatedly until it returns 0.
 *
 * @api private
 */

EncoderStream.prototype._pageout = function(fn) {
  debug('_pageout()');
  var os = this.os;
  var og = new binding.ogg_page(); //new Buffer(binding.sizeof_ogg_page);
  var self = this;
  binding.ogg_stream_pageout(os, og, function(rtn, hlen, blen, e_o_s) {
    debug(
      'ogg_stream_pageout() return = %d (hlen=%s) (blen=%s) (eos=%s)',
      rtn,
      hlen,
      blen,
      e_o_s
    );
    if (0 === rtn) {
      fn();
    } else {
      self.emit('page', self, og, hlen, blen, e_o_s);
      self._pageout(fn);
    }
  });
};

/**
 * Calls `ogg_stream_flush()` repeatedly until it returns 0.
 *
 * @api private
 */

EncoderStream.prototype._flush = function(fn) {
  debug('_flush()');
  var os = this.os;
  var og = new binding.ogg_page();
  var self = this;
  binding.ogg_stream_flush(os, og, function(rtn, hlen, blen, e_o_s) {
    debug(
      'ogg_stream_flush() return = %d (hlen=%s) (blen=%s) (eos=%s)',
      rtn,
      hlen,
      blen,
      e_o_s
    );
    if (0 === rtn) {
      fn();
    } else {
      self.emit('page', self, og, hlen, blen, e_o_s);
      self._flush(fn);
    }
  });
};
