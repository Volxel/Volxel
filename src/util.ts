export function css(strings: TemplateStringsArray, ...props: any[]) {
    let string = "";
    for (let i = 0; i < strings.length; i++) {
        string += strings[i];
        if (i < props.length) string += props[i];
    }
    const stylesheet = new CSSStyleSheet();
    stylesheet.replaceSync(string);
    return stylesheet;
}