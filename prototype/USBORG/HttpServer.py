"""
Simple HTTP server for Python3
- SSL/TLS option
- multithreaded requests and server
"""
#python version check (run by interpreter)
from sys import version_info
if version_info[0] < 3: raise Exception("Python3 required. Module http.server is needed.")

ssl = False     #generate certificate:
                #   openssl req -new -x509 -keyout server.pem -out server.pem -days 365 -nodes
                #server.pem then also contains the private key, which should be protected
import http.server #could be run standalone 'PT'
import socketserver
import os

try:
    from http import server # Python 3
except ImportError:
    import SimpleHTTPServer as server # Python 2


class MyHTTPRequestHandler(server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_my_headers()
        super().end_headers()

    def send_my_headers(self):
        self.send_header("Content-Security-Policy", "script-src 'self'; object-src 'self'; script-src-elem 'self' 'unsafe-inline'")


os.chdir(os.getcwd()+'/src')

class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer): #handles requests in a separate thread. Solves deadlock if a script tries to import other scripts in parallel and waits for them.
    pass

httpServer = ThreadedTCPServer(("0.0.0.0",8000), MyHTTPRequestHandler)
if ssl:
    import ssl
    httpServer.socket = ssl.wrap_socket (httpServer.socket, certfile='../server.pem', server_side=True)
#httpServer.serve_forever() #blocks execution

# Start a thread with the server (that starts another thread for each request)
import threading
server_thread = threading.Thread(target=httpServer.serve_forever,daemon=True) #daemon=True #daemon threads get terminated when we( non-deamon caller) terminate. No (cleaner) httpServer.shutdown() needed.
server_thread.start()
#block program, and provide shutdown command
cmd = input("Press 'Enter' to quit.\n")
httpServer.shutdown()
httpServer.server_close()
print("exiting...")







