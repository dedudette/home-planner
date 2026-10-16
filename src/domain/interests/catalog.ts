import type { CatalogInterest, Starter } from './types';

/**
 * Starter interests and small things to try. Written for this app. Each starter is something a person can actually start in a few
 * minutes with what is likely already at home. There are no books, courses, websites or videos named here: the app does not vouch for any,
 * so anything of that kind is added by the person.
 */
const S = (id: string, title: string, minutes: number, needs: string[], steps: string[]): Starter => ({ id, title, minutes, needs, steps });

export const CATALOG: CatalogInterest[] = [
  { id: 'reading', name: 'Reading', category: 'reading', blurb: 'Reading for pleasure, a little at a time.', minutes: [10, 45], budget: 'free', setting: 'either', social: 'solo', needs: ['Anything you can read'], starters: [
    S('ten-pages', 'Ten pages, no pressure', 10, ['Any book, e-reader or long article you already have'], ['Pick something you already own or can borrow.', 'Set a timer for ten minutes and sit somewhere comfortable.', 'Read until the timer ends. You do not have to finish anything.', 'Write down one line or idea you liked, or just close the book.']),
    S('read-aloud', 'Read a page aloud', 5, ['A page of anything'], ['Choose a page or a short poem.', 'Read it aloud slowly, as if to a friend.', 'Read it once more and notice what changes in how it sounds.']),
  ] },
  { id: 'singing', name: 'Singing', category: 'music', blurb: 'Using your voice for the joy of it.', minutes: [5, 30], budget: 'free', setting: 'indoor', social: 'either', needs: ['Your voice'], starters: [
    S('hum-sing', 'Hum, then sing', 5, [], ['Stand or sit tall and breathe out slowly. Hum a comfortable note for a few seconds, a few times.', 'Hum a tune you know, then open your mouth and sing it on "ah".', 'Sing one whole song you love, at whatever volume feels good.']),
    S('one-verse', 'Learn one verse by heart', 15, ['A song you like and its words'], ['Pick one verse of a song you like and read the words once.', 'Sing it line by line with the words in front of you.', 'Cover the words and try again. Repeat until you can sing it without looking.']),
  ] },
  { id: 'instrument', name: 'Playing an instrument', category: 'music', blurb: 'Making music with an instrument you have or can borrow.', minutes: [10, 40], budget: 'some', setting: 'indoor', social: 'either', needs: ['An instrument'], starters: [
    S('five-notes', 'Five slow notes', 5, ['Any instrument'], ['Sit comfortably with the instrument and take two slow breaths.', 'Play one note and listen to the sound until it fades away.', 'Play four more notes, one at a time, listening to each.', 'Choose the one you liked best and play it once more.']),
    S('play-known', 'Play something you already know', 10, ['Any instrument'], ['Pick a tune or pattern you can already play, even a little.', 'Play it slowly and steadily rather than quickly.', 'Play it once more, changing one thing: slower, softer, or with a different rhythm.']),
  ] },
  { id: 'rhythm', name: 'Rhythm with what you have', category: 'music', blurb: 'Tapping out rhythms on a table, a pan or your knees.', minutes: [5, 20], budget: 'free', setting: 'indoor', social: 'either', needs: ['A table or some pots and spoons'], starters: [
    S('four-beat', 'Four-beat patterns', 5, ['Your hands on a table or your knees'], ['Count a steady "1 2 3 4" and tap on every beat.', 'Now tap only on 1 and 3, then only on 2 and 4.', 'Make up a four-beat pattern of your own and repeat it eight times.']),
    S('copy-pattern', 'Copy and answer', 10, ['A friend, or a song with a clear beat'], ['Tap a short pattern.', 'Have someone (or yourself, a minute later) tap it back.', 'Change one beat and see if it still feels like the same pattern.']),
  ] },
  { id: 'dance', name: 'Dance for fun', category: 'dance', blurb: 'Moving to music because it feels good, not as exercise.', minutes: [5, 30], budget: 'free', setting: 'indoor', social: 'either', needs: ['Music, and a bit of floor'], starters: [
    S('one-song', 'One song, no rules', 5, ['A song you like'], ['Put on one song you like.', 'Move however you want: there are no wrong steps.', 'When it ends, stop, take a breath, and notice how you feel.']),
    S('step-turn', 'A step and a turn', 10, ['Music with a steady beat'], ['Step side to side in time with the beat.', 'On every fourth beat, turn slowly on the spot.', 'Add an arm movement that feels natural and repeat.']),
  ] },
  { id: 'drawing', name: 'Drawing', category: 'visual-art', blurb: 'Looking closely and putting what you see on paper.', minutes: [5, 45], budget: 'low', setting: 'either', social: 'either', needs: ['A pencil and paper'], starters: [
    S('contour-hand', 'Draw your hand without looking', 5, ['A pencil and paper'], ['Rest your non-drawing hand on the table and look only at it.', 'Put your pencil on the paper and, without looking down, slowly trace every line and edge you can see.', 'Keep going for five minutes. The result will look odd, and that is the point: it trains your eye.']),
    S('three-angles', 'One object, three angles', 15, ['A pencil, paper and a small object'], ['Choose a cup, shoe or piece of fruit.', 'Draw it from the front, then from the side, then from above.', 'Compare the three. What looked different?']),
  ] },
  { id: 'painting', name: 'Painting', category: 'visual-art', blurb: 'Colour, water and paper.', minutes: [15, 60], budget: 'some', setting: 'indoor', social: 'either', needs: ['Paints, a brush, paper and water'], starters: [
    S('swatches', 'Mix and label colour swatches', 15, ['Paints, a brush, paper and water'], ['Paint a small square of each colour you own.', 'Mix two colours together and paint a square of the result.', 'Write what you mixed under each square.']),
    S('wet-wash', 'A wet wash', 10, ['Watercolours or diluted paint'], ['Wet a patch of paper with clean water.', 'Touch a loaded brush to the wet paper and watch the colour spread.', 'Add a second colour and let them meet. Leave it to dry.']),
  ] },
  { id: 'sewing', name: 'Sewing and mending', category: 'crafts', blurb: 'Small repairs and simple stitching.', minutes: [10, 45], budget: 'low', setting: 'indoor', social: 'solo', needs: ['A needle, thread, scissors and some fabric'], starters: [
    S('button', 'Sew on a button', 15, ['A needle, thread and a button'], ['Cut about 50 cm of thread, pass it through the needle and knot the end.', 'From the back of the fabric, bring the needle up through one hole of the button.', 'Go down through the opposite hole and repeat about six times, then do the same for the other pair of holes if there are four.', 'Bring the needle out under the button, wind the thread round the stitches a few times, push the needle to the back and tie off with a few small knots.']),
    S('running-stitch', 'Practise a running stitch', 10, ['A needle, thread and a scrap of fabric'], ['Knot the thread and bring the needle up from the back.', 'Push it down about half a centimetre along, then up again the same distance further on.', 'Keep going in a straight line, keeping the stitches even.']),
  ] },
  { id: 'origami', name: 'Paper folding', category: 'crafts', blurb: 'Making small shapes from a single sheet of paper.', minutes: [5, 30], budget: 'free', setting: 'indoor', social: 'either', needs: ['A sheet of paper'], starters: [
    S('paper-boat', 'Fold a paper boat', 10, ['A rectangular sheet of paper'], ['Fold the sheet in half, short edge to short edge, and crease. Keep it folded with the fold at the top.', 'Fold the two top corners down to the middle so they meet, making a triangle with a strip of paper left along the bottom.', 'Fold the bottom strip up over the triangle, then turn the paper over and fold the other strip up too. This is a hat shape.', 'Open the hat out and flatten it into a diamond. Fold the bottom corner of the front layer up to the top corner, then turn over and do the same at the back.', 'Open it out and flatten it again into a diamond, then gently pull the two top points apart to open the boat.']),
    S('paper-plane', 'Fold a paper aeroplane', 5, ['A sheet of paper'], ['Fold the sheet in half lengthwise, crease, and open it again.', 'Fold the top two corners to the centre line.', 'Fold the new slanted edges to the centre line again.', 'Fold the whole thing in half along the first crease and fold each side down to make the wings. Try a gentle throw.']),
  ] },
  { id: 'language', name: 'Learning a language', category: 'languages', blurb: 'A little each day of a language you are curious about.', minutes: [5, 30], budget: 'free', setting: 'either', social: 'either', needs: ['A language you want to try, and a source you trust'], starters: [
    S('five-words', 'Five words, said aloud', 10, ['Five words you have checked with a source you trust'], ['Write down five everyday words or greetings in the language, from a book, a person or a source you trust.', 'Say each one aloud three times.', 'Cover the list and see how many you can say from memory.']),
    S('label-home', 'Label five things at home', 10, ['Sticky notes and a pen'], ['Pick five objects around you and look up their names in the language from a source you trust.', 'Write each name on a note and stick it on the object.', 'Say the word each time you use the object today.']),
  ] },
  { id: 'writing', name: 'Writing', category: 'writing', blurb: 'Putting words on a page for yourself.', minutes: [5, 40], budget: 'free', setting: 'either', social: 'solo', needs: ['Paper or a screen'], starters: [
    S('five-minutes', 'Five minutes, one prompt', 5, ['Paper or a screen'], ['Set a timer for five minutes.', 'Write without stopping, starting with "Something I noticed today was…".', 'When the timer ends, stop. You do not have to read it back.']),
    S('six-words', 'A story in six words', 5, ['Paper or a screen'], ['Think of a moment: a meeting, a goodbye, a surprise.', 'Tell it in exactly six words.', 'Write two more versions, then keep the one you like.']),
  ] },
  { id: 'nature', name: 'Noticing nature', category: 'nature', blurb: 'Slowing down to look at plants, birds and weather.', minutes: [10, 60], budget: 'free', setting: 'outdoor', social: 'either', needs: ['A window, a garden or a park'], starters: [
    S('notice-walk', 'A ten-minute notice walk', 10, [], ['Go outside, or to a window.', 'Find five different things: a texture, a colour, a sound, a smell, something moving.', 'Stand still for a minute and notice what you missed.']),
    S('one-tree', 'Watch one tree', 5, [], ['Choose one tree you can see.', 'Look at it for five minutes: its shape, how the leaves or branches move, who visits it.', 'Look at it again tomorrow and notice what has changed.']),
  ] },
  { id: 'photography', name: 'Phone photography', category: 'photography', blurb: 'Looking for pictures in ordinary places.', minutes: [10, 45], budget: 'free', setting: 'either', social: 'either', needs: ['A phone with a camera'], starters: [
    S('three-angles-photo', 'One spot, three angles', 10, ['A phone camera'], ['Pick something ordinary: a doorway, a plant, a mug.', 'Take one photo from standing height, one from low down, and one very close.', 'Look at all three and pick the one you like best.']),
    S('shadows', 'A walk for shadows', 15, ['A phone camera, and some light'], ['Go for a short walk with one rule: photograph only shadows.', 'Take at least five photos.', 'Choose your favourite and look at what makes it work.']),
  ] },
  { id: 'puzzles', name: 'Puzzles and games', category: 'games', blurb: 'Gentle puzzles and games for a quiet mind.', minutes: [10, 45], budget: 'free', setting: 'indoor', social: 'either', needs: ['A puzzle, a deck of cards or a board game you already own'], starters: [
    S('one-puzzle', 'One puzzle, no timer', 10, ['Any puzzle or game you already own'], ['Pick one puzzle or game you already own.', 'Set a ten-minute timer and play without trying to finish.', 'Stop when the timer ends, and leave it where you can pick it up again.']),
    S('cards', 'A hand of cards with someone', 15, ['A deck of cards and another person (or just you)'], ['Choose a card game you know, or invent a simple one: highest card wins.', 'Play a few rounds slowly.', 'Change one rule and play again.']),
  ] },
  { id: 'making', name: 'Making things', category: 'making', blurb: 'Building and fixing small things.', minutes: [15, 60], budget: 'low', setting: 'indoor', social: 'either', needs: ['Odds and ends from around the house'], starters: [
    S('from-recycling', 'Make something from the recycling', 20, ['Clean recycling, tape or glue, scissors'], ['Look through the recycling for a few clean boxes, tubes or tins.', 'Decide what to make: a pen holder, a small shelf, a bird feeder, a toy.', 'Build it. It does not have to be neat. Stop when it is good enough.']),
    S('small-fix', 'Fix one small thing', 15, ['Whatever the thing needs'], ['Choose one small thing that has been bothering you: a loose handle, a squeaky hinge, a torn page.', 'Work out what it needs and gather it.', 'Fix it, or decide it needs something you do not have and write that down.']),
  ] },
  { id: 'plants', name: 'Plants', category: 'nature', blurb: 'Looking after plants indoors or outside.', minutes: [5, 30], budget: 'low', setting: 'either', social: 'solo', needs: ['A plant, water and a container'], starters: [
    S('water-turn', 'Look after what you have', 5, ['A plant you already have'], ['Check each plant: is the soil dry a finger deep? Water only if it is.', 'Turn the pot a quarter turn so all sides get light.', 'Pick off any dead leaves.']),
    S('cutting', 'Root a cutting in water', 10, ['A plant that roots in water, a clean jar and water'], ['Choose a healthy stem and cut just below a joint where a leaf meets the stem.', 'Remove the lowest leaves and stand the stem in a jar of water with the joint under the water.', 'Put it in a bright place and change the water about once a week until roots appear.']),
  ] },
  { id: 'listening', name: 'Listening to music closely', category: 'music', blurb: 'Hearing a piece of music properly, with nothing else going on.', minutes: [10, 45], budget: 'free', setting: 'indoor', social: 'either', needs: ['Music and a quiet place'], starters: [
    S('one-album', 'One piece, nothing else', 15, ['A piece of music you like'], ['Choose one piece or album and put your phone out of reach.', 'Sit or lie comfortably and listen all the way through.', 'Afterwards write down one thing you noticed that you had missed before.']),
    S('follow-bass', 'Follow one instrument', 10, ['A song with several instruments'], ['Play a song and choose one instrument to follow, such as the bass or the drums.', 'Listen only to that instrument for the whole song.', 'Play it again and follow a different one.']),
  ] },
];

export const CATALOG_BY_ID = new Map(CATALOG.map((c) => [c.id, c]));
export const starterOf = (catalogId: string | null, starterId: string | null): Starter | null => (catalogId && starterId ? (CATALOG_BY_ID.get(catalogId)?.starters.find((s) => s.id === starterId) ?? null) : null);
