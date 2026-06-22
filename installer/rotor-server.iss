#define MyAppName "Rotor Interface GS232B Server"
#ifndef MyAppVersion
#define MyAppVersion "1.0.0"
#endif
#define MyAppPublisher "Rotor Interface GS232B"
#define MyAppUrl "https://github.com/timbornemann/Rotor-Interface-GS232B"
#define MyAppExeName "RotorServer.exe"
#define MyAppDataDir "{commonappdata}\Rotor Interface GS232B Server\data"

[Setup]
AppId={{8F327BC2-F69A-4A1E-9B50-62733B887CA4}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppUrl}
AppSupportURL={#MyAppUrl}
AppUpdatesURL={#MyAppUrl}
DefaultDirName={autopf}\Rotor Interface GS232B Server
DefaultGroupName=Rotor Interface GS232B Server
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
OutputDir=..\dist\installer
OutputBaseFilename=Rotor-Interface-GS232B
SetupIconFile=..\build\installer\artifact\rotor-interface.ico
UninstallDisplayIcon={app}\assets\rotor-interface.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
LicenseFile=..\LICENSE

[Languages]
Name: "german"; MessagesFile: "compiler:Languages\German.isl"

[Dirs]
Name: "{#MyAppDataDir}"; Permissions: users-modify; Flags: uninsneveruninstall

[Files]
Source: "..\build\installer\pyinstaller-dist\RotorServer\*"; DestDir: "{app}\server"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\src\renderer\*"; DestDir: "{app}\src\renderer"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\scripts\start_installed_server.bat"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\build\installer\artifact\rotor-interface.ico"; DestDir: "{app}\assets"; DestName: "rotor-interface.ico"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{commonprograms}\Rotor Interface GS232B Server\Rotor Interface GS232B Server starten"; Filename: "{app}\scripts\start_installed_server.bat"; WorkingDir: "{app}"; IconFilename: "{app}\assets\rotor-interface.ico"; Comment: "Startet den Rotor Interface GS232B Server"
Name: "{commondesktop}\Rotor Interface GS232B Server"; Filename: "{app}\scripts\start_installed_server.bat"; WorkingDir: "{app}"; IconFilename: "{app}\assets\rotor-interface.ico"; Comment: "Startet den Rotor Interface GS232B Server"
