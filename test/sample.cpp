#include <iostream>
#include <string>

// 이것은 C++ 주석입니다
class SearchClass {
private:
    // 주석 안의 search는 검색되지 않아야 합니다
    std::string searchTerm;
    
public:
    SearchClass() {
        /* 이것은 블록 주석입니다
           search 키워드가 여기에 있어도 검색되지 않아야 합니다 */
        
        // 문자열 안의 주석 토큰도 처리해야 합니다
        std::string commentInString = "// 이것은 문자열입니다";
        std::string blockCommentInString = "/* 이것도 문자열입니다 */";
        
        // 실제 검색되어야 하는 코드
        searchTerm = "이것은 검색되어야 합니다";
    }
    
    // 다른 메서드
    void searchMethod() {
        // 주석 안의 search
        std::string search = "이것도 검색되어야 합니다";
        std::cout << search << std::endl;
    }
};

/* 블록 주석 안의 search는 검색되지 않아야 합니다
   여러 줄에 걸쳐 있는 주석도 처리해야 합니다 */

// 마지막 검색 대상
int main() {
    SearchClass obj;
    obj.searchMethod();
    return 0;
} 