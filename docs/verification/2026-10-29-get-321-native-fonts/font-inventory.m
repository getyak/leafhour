#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <CoreText/CoreText.h>
#include <stdio.h>
#include <stdlib.h>

// Diagnostic only. No font registration/download APIs, app state or UI changes.
static NSDictionary *FontInfo(CTFontRef font) {
    NSString *name = CFBridgingRelease(CTFontCopyPostScriptName(font));
    NSString *family = CFBridgingRelease(CTFontCopyFamilyName(font));
    NSURL *url = CFBridgingRelease(CTFontCopyAttribute(font, kCTFontURLAttribute));
    BOOL localFile = [url isKindOfClass:NSURL.class] && url.isFileURL;
    BOOL exists = localFile && [NSFileManager.defaultManager fileExistsAtPath:url.path];
    NSDictionary *attributes = exists
        ? [NSFileManager.defaultManager attributesOfItemAtPath:url.path error:NULL] : nil;
    return @{
        @"postScriptName": name ?: NSNull.null,
        @"family": family ?: NSNull.null,
        @"pointSize": @(CTFontGetSize(font)),
        @"symbolicTraits": @(CTFontGetSymbolicTraits(font)),
        @"resourceIsFileURL": @(localFile),
        @"resourceExists": @(exists),
        @"resourceFilename": localFile ? url.lastPathComponent : (id)NSNull.null,
        @"resourceBytes": attributes[NSFileSize] ?: NSNull.null
    };
}

static NSDictionary *Trace(NSString *text, NSString *language, UIFont *font,
                           NSString *category, BOOL applyLanguageHint) {
    NSMutableDictionary *attributes = [@{
        (__bridge NSString *)kCTFontAttributeName: font
    } mutableCopy];
    if (applyLanguageHint)
        attributes[(__bridge NSString *)kCTLanguageAttributeName] = language;
    NSAttributedString *string =
        [[NSAttributedString alloc] initWithString:text attributes:attributes];
    CTLineRef line = CTLineCreateWithAttributedString((__bridge CFAttributedStringRef)string);
    CFArrayRef runs = CTLineGetGlyphRuns(line);
    NSMutableArray *records = NSMutableArray.array;
    for (CFIndex i = 0; i < CFArrayGetCount(runs); i++) {
        CTRunRef run = (CTRunRef)CFArrayGetValueAtIndex(runs, i);
        NSDictionary *runAttributes = (__bridge NSDictionary *)CTRunGetAttributes(run);
        CTFontRef actual = (__bridge CTFontRef)runAttributes[(__bridge NSString *)kCTFontAttributeName];
        CFRange range = CTRunGetStringRange(run);
        CFIndex count = CTRunGetGlyphCount(run);
        CGGlyph *glyphs = calloc((size_t)MAX(count, 1), sizeof(CGGlyph));
        CTRunGetGlyphs(run, CFRangeMake(0, count), glyphs);
        CFIndex zeros = 0;
        for (CFIndex j = 0; j < count; j++) if (glyphs[j] == 0) zeros++;
        free(glyphs);
        [records addObject:@{
            @"utf16Location": @(range.location),
            @"utf16Length": @(range.length),
            @"glyphCount": @(count),
            // A zero glyph is raw diagnostic data, not a coverage verdict.
            @"glyphZeroCount": @(zeros),
            @"font": FontInfo(actual)
        }];
    }
    CFRelease(line);
    return @{
        @"text": text,
        @"declaredSampleLanguage": language,
        @"languageHintApplied": @(applyLanguageHint),
        @"utf16Length": @(text.length),
        @"contentSizeCategory": category,
        @"requestedUIFontName": font.fontName,
        @"requestedUIFontFamily": font.familyName,
        @"requestedFont": FontInfo((__bridge CTFontRef)font),
        @"runs": records
    };
}

int main(void) {
    @autoreleasepool {
        NSArray *families = [UIFont.familyNames sortedArrayUsingSelector:@selector(compare:)];
        NSMutableArray *familyRecords = NSMutableArray.array;
        NSMutableSet *allNames = NSMutableSet.set;
        for (NSString *family in families) {
            NSArray *names = [[UIFont fontNamesForFamilyName:family]
                sortedArrayUsingSelector:@selector(compare:)];
            [allNames addObjectsFromArray:names];
            [familyRecords addObject:@{@"family": family, @"faceNames": names}];
        }
        NSArray *ctNames = [(NSArray *)CFBridgingRelease(
            CTFontManagerCopyAvailablePostScriptNames())
            sortedArrayUsingSelector:@selector(compare:)];
        [allNames addObjectsFromArray:ctNames];
        NSMutableArray *loads = NSMutableArray.array;
        for (NSString *name in [allNames.allObjects sortedArrayUsingSelector:@selector(compare:)]) {
            @autoreleasepool {
                UIFont *font = [UIFont fontWithName:name size:22];
                NSString *resolvedName = font.fontName;
                [loads addObject:@{
                    @"requestedName": name,
                    @"uiFontConstructed": @(font != nil),
                    @"resolvedName": resolvedName ?: (id)NSNull.null,
                    @"resolvedNameMatchesRequest": @(font && [resolvedName isEqualToString:name]),
                    @"actual": font ? FontInfo((__bridge CTFontRef)font) : (id)NSNull.null
                }];
            }
        }
        UIFont *base = [UIFont systemFontOfSize:22];
        UIFontDescriptor *serif = [base.fontDescriptor
            fontDescriptorWithDesign:UIFontDescriptorSystemDesignSerif];
        UIFont *body = [UIFont fontWithDescriptor:serif ?: base.fontDescriptor size:22];
        NSArray *samples = @[
            @[@"en", @"Reading café e\u0301, finite and infinite."],
            @[@"zh-Hans", @"阅读字体：汉字、边界与安静的书页。"],
            @[@"zh-Hant", @"閱讀字體：漢字、邊界與安靜的書頁。"],
            @[@"ja", @"読書の時間。かな・カナ・漢字。"],
            @[@"ja", @"読書"],
            @[@"ko", @"한글을 읽는 조용한 시간."],
            @[@"und", @"A e\u0301 𠮷 👩🏽‍💻 🏳️‍🌈 漢字"]
        ];
        NSMutableArray *traces = NSMutableArray.array;
        for (NSString *category in @[UIContentSizeCategoryLarge,
                 UIContentSizeCategoryAccessibilityExtraExtraExtraLarge]) {
            UITraitCollection *traits = [UITraitCollection
                traitCollectionWithPreferredContentSizeCategory:category];
            UIFont *scaled = [[UIFontMetrics metricsForTextStyle:UIFontTextStyleBody]
                scaledFontForFont:body compatibleWithTraitCollection:traits];
            for (NSArray *sample in samples) {
                [traces addObject:Trace(sample[1], sample[0], scaled, category, NO)];
                [traces addObject:Trace(sample[1], sample[0], scaled, category, YES)];
            }
        }
        NSMutableSet *runNames = NSMutableSet.set;
        for (NSDictionary *trace in traces)
            for (NSDictionary *run in trace[@"runs"])
                [runNames addObject:run[@"font"][@"postScriptName"]];
        NSMutableArray *fallbackLoads = NSMutableArray.array;
        for (NSString *name in [runNames.allObjects sortedArrayUsingSelector:@selector(compare:)]) {
            UIFont *font = [UIFont fontWithName:name size:22];
            NSString *resolvedName = font.fontName;
            [fallbackLoads addObject:@{
                @"observedRunName": name,
                @"presentInInitialEnumeration": @([allNames containsObject:name]),
                @"uiFontConstructedAfterShaping": @(font != nil),
                @"resolvedName": resolvedName ?: (id)NSNull.null,
                @"resolvedNameMatchesObservedRun": @(font && [resolvedName isEqualToString:name]),
                @"actual": font ? FontInfo((__bridge CTFontRef)font) : (id)NSNull.null
            }];
        }
        NSDictionary *result = @{
            @"schema": @1,
            @"scope": @"One runtime; standalone UIKit/CoreText diagnostic, not reader UI or glyph-quality acceptance.",
            @"networkBoundary": @"No registration/download/network APIs invoked by this probe; shared network state unchanged, not airplane-mode acceptance.",
            @"generatedAt": [NSISO8601DateFormatter.new stringFromDate:NSDate.date],
            @"runtimeVersion": UIDevice.currentDevice.systemVersion,
            @"runtimeSystem": UIDevice.currentDevice.systemName,
            @"model": NSProcessInfo.processInfo.environment[@"SIMULATOR_MODEL_IDENTIFIER"] ?: @"unknown",
            @"serifDesignDescriptorReturned": @(serif != nil),
            @"uiFamilies": familyRecords,
            @"coreTextAvailablePostScriptNames": ctNames,
            @"fontLoads": loads,
            @"observedRunUIFontLoads": fallbackLoads,
            @"currentSerifSampleTraces": traces
        };
        NSError *error = nil;
        NSData *json = [NSJSONSerialization dataWithJSONObject:result
            options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys error:&error];
        if (!json) {
            fprintf(stderr, "JSON serialization failed: %s\n", error.localizedDescription.UTF8String);
            return 2;
        }
        fwrite(json.bytes, 1, json.length, stdout);
        fputc('\n', stdout);
    }
    return 0;
}
