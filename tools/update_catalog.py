# -*- coding: utf-8 -*-
"""用脚本精确替换 server.py 里的 CATALOG 块（避免手工匹配缩进出错）。"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, 'server.py')

NEW_CATALOG = '''CATALOG = [
    {"group": "A股 · 宽基指数", "color": "#e5484d", "items": [
        {"secid": "1.000300", "name": "沪深300"},
        {"secid": "1.000510", "name": "中证A500"},
        {"secid": "2.930050", "name": "中证A50", "proxy": "1.000300"},
        {"secid": "1.000016", "name": "上证50"},
        {"secid": "1.000905", "name": "中证500"},
        {"secid": "1.000852", "name": "中证1000"},
        {"secid": "0.399006", "name": "创业板指"},
        {"secid": "1.000688", "name": "科创50", "proxy": "0.399006"},
        {"secid": "0.399001", "name": "深证成指"},
        {"secid": "0.899050", "name": "北证50", "proxy": "1.000852"},
    ]},
    {"group": "A股 · 宽基ETF", "color": "#be123c", "items": [
        {"secid": "1.510300", "name": "沪深300ETF（华泰柏瑞）", "proxy": "1.000300"},
        {"secid": "1.510500", "name": "中证500ETF（南方）", "proxy": "1.000905"},
        {"secid": "1.510050", "name": "上证50ETF（华夏）", "proxy": "1.000016"},
        {"secid": "1.512100", "name": "中证1000ETF（南方）", "proxy": "1.000852"},
        {"secid": "1.588000", "name": "科创50ETF（华夏）", "proxy": "1.000688"},
        {"secid": "1.563300", "name": "中证2000ETF（华泰柏瑞）", "proxy": "1.000852"},
        {"secid": "0.159915", "name": "创业板ETF（易方达）", "proxy": "0.399006"},
        {"secid": "0.159949", "name": "创业板50ETF（华安）", "proxy": "0.399006"},
    ]},
    {"group": "A股 · 红利/策略", "color": "#f5a524", "items": [
        {"secid": "1.000922", "name": "中证红利"},
        {"secid": "1.000015", "name": "上证红利"},
        {"secid": "1.510880", "name": "红利ETF（华泰柏瑞）"},
        {"secid": "1.512890", "name": "红利低波ETF（华泰柏瑞）", "proxy": "1.510880"},
    ]},
    {"group": "A股 · 科技ETF", "color": "#0ea5e9", "items": [
        {"secid": "1.512480", "name": "半导体ETF（国联安）", "proxy": "0.399006"},
        {"secid": "1.512760", "name": "芯片ETF（国泰）", "proxy": "0.399006"},
        {"secid": "1.512720", "name": "计算机ETF（国泰）", "proxy": "0.399006"},
        {"secid": "1.515880", "name": "通信ETF（国泰）", "proxy": "0.399006"},
        {"secid": "1.516010", "name": "游戏ETF（国泰）", "proxy": "0.399006"},
        {"secid": "1.588200", "name": "科创芯片ETF（嘉实）", "proxy": "1.000688"},
    ]},
    {"group": "A股 · 医药ETF", "color": "#22c55e", "items": [
        {"secid": "1.512170", "name": "医疗ETF（华宝）", "proxy": "0.399006"},
        {"secid": "1.512010", "name": "医药ETF（易方达）", "proxy": "0.399006"},
        {"secid": "0.159992", "name": "创新药ETF（银华）", "proxy": "0.399006"},
    ]},
    {"group": "A股 · 消费ETF", "color": "#f43f5e", "items": [
        {"secid": "1.512690", "name": "酒ETF（鹏华）", "proxy": "1.000300"},
        {"secid": "0.159928", "name": "消费ETF（汇添富）", "proxy": "1.000300"},
        {"secid": "0.159996", "name": "家电ETF（国泰）", "proxy": "1.000300"},
    ]},
    {"group": "A股 · 周期/资源ETF", "color": "#a16207", "items": [
        {"secid": "1.512400", "name": "有色金属ETF（南方）", "proxy": "1.000300"},
        {"secid": "1.515220", "name": "煤炭ETF（国泰）", "proxy": "1.000300"},
        {"secid": "1.515210", "name": "钢铁ETF（国泰）", "proxy": "1.000300"},
        {"secid": "0.159825", "name": "农业ETF（富国）", "proxy": "1.000300"},
    ]},
    {"group": "A股 · 新能源/制造ETF", "color": "#16a34a", "items": [
        {"secid": "1.516160", "name": "新能源ETF（南方）", "proxy": "0.399006"},
        {"secid": "1.515790", "name": "光伏ETF（华泰柏瑞）", "proxy": "0.399006"},
        {"secid": "0.159755", "name": "电池ETF（广发）", "proxy": "0.399006"},
    ]},
    {"group": "A股 · 金融/地产ETF", "color": "#7c3aed", "items": [
        {"secid": "1.512880", "name": "证券ETF（国泰）", "proxy": "1.000300"},
        {"secid": "1.512800", "name": "银行ETF（华宝）", "proxy": "1.000300"},
        {"secid": "1.512000", "name": "券商ETF（华宝）", "proxy": "1.000300"},
        {"secid": "1.512200", "name": "房地产ETF（南方）", "proxy": "1.000300"},
        {"secid": "1.516950", "name": "基建ETF（银华）", "proxy": "1.000300"},
    ]},
    {"group": "A股 · 军工/传媒/环保ETF", "color": "#0891b2", "items": [
        {"secid": "1.512660", "name": "军工ETF（国泰）", "proxy": "1.000300"},
        {"secid": "1.512980", "name": "传媒ETF（广发）", "proxy": "0.399006"},
        {"secid": "1.512580", "name": "环保ETF（广发）", "proxy": "0.399006"},
    ]},
    {"group": "中国香港股市", "color": "#0090ff", "items": [
        {"secid": "100.HSI", "name": "恒生指数"},
        {"secid": "124.HSTECH", "name": "恒生科技指数", "proxy": "100.HSI"},
        {"secid": "100.HSCEI", "name": "恒生国企指数"},
        {"secid": "124.HSHDYI", "name": "恒生高股息率指数"},
    ]},
    {"group": "港股 · 中概ETF", "color": "#0284c7", "items": [
        {"secid": "1.513050", "name": "中概互联网ETF（易方达）", "proxy": "100.HSI"},
        {"secid": "1.513180", "name": "恒生科技ETF（华夏）", "proxy": "100.HSI"},
        {"secid": "1.513130", "name": "恒生科技ETF（华泰柏瑞）", "proxy": "100.HSI"},
        {"secid": "1.513330", "name": "恒生互联网ETF（华夏）", "proxy": "100.HSI"},
        {"secid": "1.513060", "name": "恒生医疗ETF（博时）", "proxy": "100.HSI"},
        {"secid": "1.513970", "name": "恒生消费ETF（景顺）", "proxy": "100.HSI"},
    ]},
    {"group": "美国股市", "color": "#8b5cf6", "items": [
        {"secid": "100.NDX100", "name": "纳斯达克100", "proxy": "100.NDX"},
        {"secid": "100.NDX", "name": "纳斯达克综合指数"},
        {"secid": "100.SPX", "name": "标普500"},
        {"secid": "100.DJIA", "name": "道琼斯工业指数"},
    ]},
    {"group": "黄金 / 商品", "color": "#d4a72c", "items": [
        {"secid": "122.XAU", "name": "伦敦金（美元/盎司）"},
        {"secid": "101.GC00Y", "name": "COMEX黄金"},
        {"secid": "1.518880", "name": "黄金ETF（人民币计价）", "proxy": "122.XAU"},
        {"secid": "122.XAG", "name": "伦敦银（美元/盎司）"},
        {"secid": "102.CL00Y", "name": "NYMEX原油"},
    ]},
    {"group": "债券 / 固收", "color": "#12a594", "items": [
        {"secid": "1.511260", "name": "十年国债ETF", "synth": "bond"},
        {"secid": "1.511090", "name": "30年国债ETF", "proxy": "1.511260"},
    ]},
    {"group": "现金类（无行情，按固定利率）", "color": "#64748b", "items": [
        {"secid": "CASH", "name": "现金 / 活期", "fixed": 0.30},
        {"secid": "DEP1", "name": "定期存款 / 大额存单", "fixed": 2.00},
        {"secid": "MMF", "name": "货币基金 / 理财", "fixed": 1.80},
    ]},
]
'''


def main():
    src = open(TARGET, encoding='utf-8').read()
    start = src.index('CATALOG = [')
    end = src.index('\n]\n', start) + 3
    src2 = src[:start] + NEW_CATALOG + src[end:]
    open(TARGET, 'w', encoding='utf-8').write(src2)
    print('CATALOG 已更新：原 %d 字符 -> 新 %d 字符' % (end - start, len(NEW_CATALOG)))


TARGET = TARGET
if __name__ == '__main__':
    main()
