from pygments import highlight
from pygments.lexers import get_lexer_by_name
from pygments.formatters import ImageFormatter

code = '''class MyTask implements Runnable {
    public void run() {
        System.out.println("Hello");
    }
}'''
try:
    lexer = get_lexer_by_name('java')
    formatter = ImageFormatter(font_name='Liberation Mono', font_size=32)
    img_data = highlight(code, lexer, formatter)
    with open('/app/output/test_code.png', 'wb') as f:
        f.write(img_data)
    print('Success')
except Exception as e:
    print('Error:', e)
