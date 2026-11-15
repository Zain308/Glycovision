# Food recognition: dataset guide

The camera model learns from photos sorted into one folder per dish. The folder name must be the dish's **slug** from `food_classes.json`.

```
food-dataset/
    biryani/        photo001.jpg, photo002.jpg, ...
    nihari/
    not_food/
```

## How many photos

| Status | Photos per dish |
|---|---|
| Minimum to train | 150 |
| Good | 300 or more |

Collect **priority 1** dishes first (marked ★). Check progress any time:

```powershell
cd E:\Glycovision\glycovision-backend
.\venv\Scripts\python.exe ml\food\check_dataset.py E:\Glycovision\food-dataset
```

## Photo rules

- **One dish per photo**, filling most of the frame. Photos of a full thali go in no folder.
- **Variety matters more than count:** different plates, homes, restaurants, lighting, angles (top-down and 45°), portion sizes.
- Real photos only: no collages, no text overlays, no screenshots of menus.
- JPG or PNG, at least 300 px on the short side. Phone photos are perfect.
- **not_food:** people, rooms, hands, phones, empty plates, pets, documents. This teaches the model to say "no food".
- Record where photos came from in `sources.csv` (folder, source, licence). Your own photos are your own data: say so in the thesis.

## Dishes (94)

**Rice:** ★ Biryani (`biryani`), ★ Chicken Pulao (`chicken_pulao`), ★ Daal Chawal (`daal_chawal`), Fried Rice (`fried_rice`), ★ Plain Rice (`plain_rice`)

**Curries:** ★ Nihari (`nihari`), ★ Chicken Karahi (`chicken_karahi`), Mutton Karahi (`mutton_karahi`), ★ Chicken Qorma (`chicken_qorma`), ★ Aloo Gosht (`aloo_gosht`), ★ Chicken Salan (`chicken_salan`), ★ Haleem (`haleem`), Paya (`paya`), ★ Keema (`keema`), Kofta Curry (`kofta`), Butter Chicken (`butter_chicken`)

**BBQ & fried:** ★ Seekh Kebab (`seekh_kebab`), ★ Chapli Kebab (`chapli_kebab`), ★ Shami Kebab (`shami_kebab`), ★ Chicken Tikka (`chicken_tikka`), BBQ Boti (`bbq`), Chicken Wings (`chicken_wings`), ★ Broast / Fried Chicken (`broast`), Fried Fish (`fish_fry`)

**Lentils & beans:** ★ Daal (`daal`), ★ Chana (Chickpea Curry) (`chana`), Lobia (`lobia`)

**Vegetables:** ★ Aloo Gobi (`aloo_gobi`), ★ Bhindi (`bhindi`), ★ Saag (`saag`), Karela (`karela`), Baingan Bharta (`baingan_bharta`), ★ Mixed Vegetables (`mix_sabzi`), ★ Aloo Sabzi (`aloo_sabzi`), Palak Paneer (`palak_paneer`), Kadai Paneer (`kadai_paneer`)

**Breads:** ★ Roti / Chapati (`chapati`), ★ Naan (`naan`), ★ Paratha (`paratha`), ★ Aloo Paratha (`aloo_paratha`), Puri (`puri`), ★ Bread / Toast (`bread_slice`), Bun (`bun`)

**Breakfast & eggs:** ★ Halwa Puri (`halwa_puri`), ★ Omelette (`omelette`), ★ Fried Egg (`fried_egg`), ★ Boiled Egg (`boiled_egg`), Cereal with Milk (`cereal`)

**Snacks & fast food:** ★ Samosa (`samosa`), ★ Pakora (`pakora`), ★ Chaat (`chaat`), Gol Gappay (`gol_gappay`), Dahi Bhalla (`dahi_bhalla`), Spring Roll (`spring_roll`), ★ Paratha Roll (`paratha_roll`), ★ Shawarma (`shawarma`), ★ Sandwich (`sandwich`), ★ Burger (`burger`), ★ Pizza (`pizza`), ★ French Fries (`french_fries`), Chicken Nuggets (`nuggets`), Biscuits (`biscuits`)

**Sweets:** ★ Gulab Jamun (`gulab_jamun`), ★ Jalebi (`jalebi`), Ras Malai (`ras_malai`), ★ Kheer (`kheer`), ★ Gajar Halwa (`gajar_halwa`), Suji Halwa (`suji_halwa`), Zarda (`zarda`), Barfi / Mithai (`barfi`), Kulfi (`kulfi`), ★ Ice Cream (`ice_cream`), ★ Cake (`cake`), Cupcake (`cupcakes`), Donut (`donuts`), Brownie (`brownie`)

**Drinks:** ★ Chai (`chai`), ★ Lassi (`lassi`), Milk (`milk`), ★ Soft Drink (`soft_drink`), ★ Fruit Juice (`juice`), Coffee (`coffee`)

**Fruit:** ★ Apple (`apple`), ★ Banana (`banana`), ★ Mango (`mango`), ★ Orange / Kinnow (`orange`), Grapes (`grapes`), Watermelon (`watermelon`), Guava (`guava`), ★ Dates (Khajoor) (`dates`)

**Sides:** Raita (`raita`), Salad (`salad`), Yogurt (Dahi) (`yogurt`)

**Required:** ★ Not food (people, rooms, objects, screens) (`not_food`)
