'use strict';
// Compile the actual firmware preflight handler with instrumented host stubs.
// No Arduino build, SD access, network, printer, UV or motor operation occurs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),text=fs.readFileSync(path.join(root,'src/Network.ino'),'utf8');
const a=text.indexOf('static void preflightCheck('),b=text.indexOf('// POST /api/move',a);assert.ok(a>=0&&b>a);
const code=`#include <cassert>
#include <cmath>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <type_traits>
class String {
 public: std::string value;
 String(){} String(const char* s):value(s?s:""){} String(const std::string& s):value(s){}
 template<class T, typename std::enable_if<std::is_arithmetic<T>::value,int>::type=0>
 String(T n){std::ostringstream o;o<<n;value=o.str();}
 String(double n,int precision){std::ostringstream o;o<<std::fixed<<std::setprecision(precision)<<n;value=o.str();}
 size_t length()const{return value.length();}
 String& operator+=(const String& b){value+=b.value;return *this;}
 friend String operator+(String a,const String& b){return a+=b;}
};
bool busy=false,web=true,valid=true,summary=true,sd=true,zHomed=true,uvLedEnabled=true;
int validReads=0,summaryReads=0,resinReads=0,errorCode=0;
String resinProfileName="Standard",requested="test-cap";
double Layer_Height=.05,Base_Exposure=25,Base_Layer=5,Regular_Exposure=30;
int lowResinThresholdMl=5;const int MAX_LAYER_FILES=4000;std::string response;
struct Server {String arg(const char*){return requested;}}server;
struct ModelSummary {float slicedLayerHeightMm=.05f;int sourceLayers=100;};
bool webDashboardRuntimeEnabled(){return web;}bool printerBusy(){return busy;}bool sdCardReady(){return sd;}
String sanitizeSlug(const String& s,const char*){return s;}String jsonEscape(const String& s){return s;}
bool validPrintableModel(const String&){validReads++;return valid;}
bool modelSummaryForModel(const String&,ModelSummary&){summaryReads++;return summary;}
bool getModelMetadataResin(const String&,double&){resinReads++;return false;}
float vatRemaining(){return 30;}
void sendApiError(int n,const char* e){errorCode=n;response=e;}
void sendApiOk(const String& s){response=s.value;}
`+text.slice(a,b)+`
void reset(){validReads=summaryReads=resinReads=errorCode=0;response.clear();}
int main(){
 busy=true;reset();handleApiPreflight();
 assert(validReads==0&&summaryReads==0&&resinReads==0);
 assert(response.find("\\\"ready\\\":false")!=std::string::npos);
 assert(response.find("printer is busy - model checks wait until it is idle")!=std::string::npos);
 busy=false;reset();handleApiPreflight();
 assert(validReads==1&&summaryReads==1&&resinReads==1);
 assert(response.find("\\\"ready\\\":true")!=std::string::npos);
 valid=false;reset();handleApiPreflight();assert(validReads==1&&summaryReads==0&&resinReads==0);
 assert(response.find("model not found")!=std::string::npos);
 web=false;reset();handleApiPreflight();assert(errorCode==403&&validReads==0&&summaryReads==0&&resinReads==0);
 std::cout<<"4 native preflight groups pass: busy skips all model SD reads; idle checks the model; missing model and disabled web control fail.\\n";
}
`;
const out=path.join(root,'.cache/preflight-native');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'test.cpp'),code);
let compile;
if(process.platform==='win32'){
 const vc=process.env.TINYMAKER_VCVARS||'C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Auxiliary/Build/vcvars64.bat';assert.ok(fs.existsSync(vc),'Set TINYMAKER_VCVARS to an installed MSVC vcvars64.bat');
 fs.writeFileSync(path.join(out,'run.cmd'),'@echo off\r\ncall "'+vc+'" >nul\r\nif errorlevel 1 exit /b %errorlevel%\r\ncl /nologo /EHsc /std:c++14 test.cpp /Fe:test.exe\r\nif errorlevel 1 exit /b %errorlevel%\r\ntest.exe\r\nexit /b %errorlevel%\r\n');
 compile=spawnSync('cmd.exe',['/d','/c','run.cmd'],{cwd:out,encoding:'utf8',windowsHide:true});
}else{
 compile=spawnSync(process.env.CXX||'c++',['-std=c++14','test.cpp','-o','test'],{cwd:out,encoding:'utf8'});
 if(compile.status===0)compile=spawnSync('./test',[],{cwd:out,encoding:'utf8'});
}
process.stdout.write(compile.stdout||'');process.stderr.write(compile.stderr||'');if(compile.error)throw compile.error;assert.equal(compile.status,0,'Native preflight test failed');
