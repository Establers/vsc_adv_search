// 이것은 한 줄 주석입니다
function searchFunction() {
    // 주석 안의 search는 검색되지 않아야 합니다
    const searchTerm = "검색할 텍스트";
    
    /* 이것은 블록 주석입니다
       search 키워드가 여기에 있어도 검색되지 않아야 합니다 */
    
    // 문자열 안의 주석 토큰도 처리해야 합니다
    const commentInString = "// 이것은 문자열입니다";
    const blockCommentInString = "/* 이것도 문자열입니다 */";
    
    // 실제 검색되어야 하는 코드
    const searchResult = "이것은 검색되어야 합니다";
    
    return searchResult;
}

// 다른 함수
function anotherFunction() {
    // 주석 안의 search
    const search = "이것도 검색되어야 합니다";
    return search;
}

/* 블록 주석 안의 search는 검색되지 않아야 합니다
   여러 줄에 걸쳐 있는 주석도 처리해야 합니다 */

// 마지막 검색 대상
const finalSearch = "마지막 검색 결과"; 