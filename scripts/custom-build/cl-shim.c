// Build-only stand-in for cl.exe: runs LLVM's clang-cl with the same command-line arguments.
#include <windows.h>
#include <wchar.h>

int wmain(void) {
  const wchar_t *line = GetCommandLineW();
  // Skip argv[0], quoted or not.
  if (*line == L'"') {
    line = wcschr(line + 1, L'"');
    line = line ? line + 1 : L"";
  } else {
    while (*line && *line != L' ' && *line != L'\t') line++;
  }
  static wchar_t command[32768];
  swprintf(command, 32768, L"\"C:\\Program Files\\LLVM\\bin\\clang-cl.exe\"%ls", line);
  STARTUPINFOW startup = {sizeof(startup)};
  PROCESS_INFORMATION process;
  if (!CreateProcessW(NULL, command, NULL, NULL, TRUE, 0, NULL, NULL, &startup, &process)) {
    return 127;
  }
  WaitForSingleObject(process.hProcess, INFINITE);
  DWORD code = 1;
  GetExitCodeProcess(process.hProcess, &code);
  return (int)code;
}
