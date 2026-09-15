#ifndef TM_FETCH_STREAM_H
#define TM_FETCH_STREAM_H

#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

// The core decides response framing when it sends the headers. In particular,
// unknown length means chunked for HTTP/1.1, but close-delimited for HTTP/1.0.
// Expose that decision without changing WebServer's parsing or send behavior.
template<class ServerBase>
class TmResponseServer : public ServerBase {
 public:
  explicit TmResponseServer(uint16_t port) : ServerBase(port) {}
  bool responseIsChunked() const { return this->_chunked; }
};

// Adapter for HTTPClient::writeToStream: the upstream library decodes chunks;
// this writes a fresh browser response while checking every socket write.
// Templated only so the SAME implementation runs with a fake socket in native
// tests. Firmware uses Stream + WiFiClient, without an intermediate model copy.
template<class StreamBase, class Client>
class TmFetchStream : public StreamBase {
 public:
  size_t written = 0;
  bool failed = false;

  TmFetchStream(Client client, bool chunked, size_t limit)
      : client_(client), chunked_(chunked), limit_(limit) {}

  template<class Server>
  TmFetchStream(Server &server, size_t limit)
      : TmFetchStream(server.client(), server.responseIsChunked(), limit) {}

  size_t write(uint8_t b) override { return write(&b, 1); }
  size_t write(const uint8_t *buf, size_t n) override {
    if (failed) return 0;
    // Bound unknown-length/chunked transfers too; subtraction cannot wrap.
    if (!client_.connected() || written > limit_ || n > limit_ - written) return fail();
    if (!n) return 0;
    if (chunked_) {
      char header[2 * sizeof(size_t) + 3];
      int length = snprintf(header, sizeof(header), "%lx\r\n", (unsigned long)n);
      if (length <= 0 || (size_t)length >= sizeof(header) ||
          !put((const uint8_t *)header, (size_t)length)) return fail();
    }
    if (!put(buf, n)) return fail();
    if (chunked_ && !put((const uint8_t *)"\r\n", 2)) return fail();
    written += n;
    return n;
  }

  // Call before sending the final zero chunk. A negative upstream result or
  // short body must close the socket unfinished so fetch() rejects the body.
  bool complete(int result, int expectedLength) const {
    return !failed && result >= 0 && (size_t)result == written &&
           (expectedLength < 0 || (size_t)expectedLength == written);
  }
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  void flush() override {}

 private:
  Client client_;
  bool chunked_;
  size_t limit_;
  bool put(const uint8_t *buf, size_t n) { return client_.write(buf, n) == n; }
  size_t fail() {
    failed = true;
    this->setWriteError();
    client_.stop();
    return 0;
  }
};

#endif
