import http.server,json,urllib.parse,threading
OWNER='00000000-0000-4000-8000-000000000315'
USER={'id':OWNER,'email':'native@example.invalid'}
BOOK='native-markdown-fixture';VERSION='native-source-v1'
CHAPTERS=[{'id':'chapter-one','title':{'en':'Chapter one'}},{'id':'chapter-two','title':{'en':'Chapter two'}}]
SECTIONS=[{'chapterId':'chapter-one','paragraphs':[
 {'id':'heading-one','original':'# A quiet native page','source':{'type':'heading'},'translations':{}},
 {'id':'passage-one','original':'A **gentle** page with *emphasis*, a [safe link](https://leafhour.com) and café 🐿️.','translations':{'literal':{'text':'一页安静的原文，带着强调和咖啡。','status':'reviewed'},'interpretive':{'text':'留一点安静，慢慢读下去。','status':'draft'}}},
 {'id':'passage-table','original':'| Tool | State |\n| --- | --- |\n| Native | Ready |\n\n```swift\nlet page = 1\n```','translations':{}}]},
 {'chapterId':'chapter-two','paragraphs':[{'id':'passage-two','original':'Only the second chapter belongs on this page.','translations':{}}]}]
NOTES=[{'id':'web-note','origin':'user','passageId':'passage-one','text':'A note saved on the web.','quote':'gentle','createdAt':'2026-10-29T00:00:00.000Z','updatedAt':'2026-10-29T00:00:00.000Z'}]
POSITION=None
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def reply(self,value,status=200,headers=None):
  body=json.dumps(value,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)))
  for k,v in (headers or {}).items():self.send_header(k,v)
  self.end_headers();self.wfile.write(body)
 def do_GET(self):
  global POSITION
  path=urllib.parse.urlparse(self.path).path
  signed='marginalia_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' in self.headers.get('Cookie','')
  if path=='/api/auth/session':return self.reply({'user':USER if signed else None,'passwordAvailable':True,'providers':{'google':True,'apple':True},'nativeOAuth':{'version':1},'billing':{'enabled':False}})
  if path=='/fixture-state':return self.reply({'notes':len(NOTES),'position':POSITION})
  if not signed:return self.reply({'error':'Please sign in'},401)
  if path=='/api/auth/identities':return self.reply({'user':USER,'identities':[{'provider':'email','email':USER['email'],'emailVerified':True},{'provider':'google','email':USER['email'],'emailVerified':True}],'providers':{'google':True,'apple':True}})
  book={'bookId':BOOK,'contentVersion':VERSION,'title':{'en':'Native Markdown Fixture'},'author':'Isolated test','source':{'format':'md'},'chapters':CHAPTERS,'readingCache':{'snapshotId':'fixture-snapshot'}}
  if path=='/api/library':return self.reply({'user':USER,'books':[book]})
  if path.endswith('/reading-manifest'):return self.reply({**book,'sections':[]})
  if '/chapters/' in path:
   chapter=path.rsplit('/',1)[-1];return self.reply({'bookId':BOOK,'contentVersion':VERSION,'chapterId':chapter,'sections':[s for s in SECTIONS if s['chapterId']==chapter],'snapshotId':'fixture-snapshot'})
  if path.endswith('/records'):return self.reply({'bookId':BOOK,'contentVersion':VERSION,'comments':NOTES,'questions':[],'position':POSITION})
  if path=='/api/library/notebook':return self.reply({'entries':[{'book':book,'records':{'comments':NOTES,'questions':[]}}],'nextCursor':None,'total':1,'completed':1})
  if path=='/api/library/notebook-workspace':return self.reply({'relations':[{'id':'summary-one','text':'A saved reading summary from the web.','noteKeys':['fixture-note']}],'candidates':[]})
  if path=='/api/library/reading-summary':return self.reply({'allTime':{'durationSeconds':900,'readingDays':3},'books':[dict(book,durationSeconds=900)]})
  if path.endswith('/introduction'):return self.reply({'source':'provided','text':'A saved introduction for a quiet reader.'})
  if path.endswith('/chat'):return self.reply({'available':True,'scope':{'mode':'book','revision':0},'turns':[]})
  return self.reply({'error':'Unknown fixture endpoint'},404)
 def do_POST(self):
  global POSITION
  path=urllib.parse.urlparse(self.path).path;body=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))) or b'{}')
  if path=='/api/auth/password':return self.reply({'user':USER},headers={'Set-Cookie':'marginalia_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA; HttpOnly; SameSite=Strict; Path=/'})
  if path=='/api/auth/logout':return self.reply({'signedOut':True})
  if path.endswith('/comments'):
   old=next((n for n in NOTES if n['id']==body['id']),None)
   if old:return self.reply(old)
   NOTES.append(dict(body,createdAt='2026-10-29T01:00:00.000Z',updatedAt='2026-10-29T01:00:00.000Z'));return self.reply(NOTES[-1],201)
  if path.endswith('/progress'):
   revision=(POSITION or {}).get('revision',0)
   if body.get('baseRevision')!=revision:return self.reply({'error':'Newer position'},409)
   POSITION=dict(body,revision=revision+1);return self.reply(POSITION)
  return self.reply({'error':'Generation is intentionally unavailable in native acceptance fixtures'},503)
http.server.ThreadingHTTPServer(('127.0.0.1',18735),Handler).serve_forever()
